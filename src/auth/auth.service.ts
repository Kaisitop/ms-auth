import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginUserDto, RegisterUserDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto, ResendVerificationDto, CreateUserByAdminDto, BulkImportUsersDto } from './dto';
import { parseUsersImportFile } from './utils/user-import.parser';
import * as bcrypt from 'bcrypt';

import { ClientProxy, RpcException } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces/payload.interface';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { DispositivosService } from '../dispositivos/dispositivos.service';

// Tiempos de vida de los tokens de un solo uso
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const RESET_TOKEN_TTL_MIN = RESET_TOKEN_TTL_MS / 60000;
const VERIF_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService,
    private jwtService : JwtService,
    private readonly auditService: AuditService,
    private readonly dispositivosService: DispositivosService,
    @Inject('NATS_SERVICE') private readonly natsClient: ClientProxy,
  ) {}

  /** Emite un evento de envío de correo sin bloquear el flujo principal. */
  private emitEmailEvent(pattern: string, payload: Record<string, unknown>) {
    try {
      this.natsClient.emit(pattern, payload);
    } catch (error) {
      this.logger.error(
        `No se pudo emitir el evento ${pattern}: ${(error as Error).message}`,
      );
    }
  }
  
  async generateToken(jwtPayload: JwtPayload){
    return await this.jwtService.signAsync(jwtPayload)
  }

  async registerUser(registerUserDto: RegisterUserDto) {
    const { email, password, nombre, telefono } = registerUserDto;
    const rolNombre = 'Ciudadano';

    const existingUser = await this.prisma.usuario.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      throw new RpcException({
        statusCode: 409,
        message: 'El Usuario ya existe',
      });
    }

    const role = await this.prisma.rol.findUnique({
      where: { nombre: rolNombre },
    });

    if (!role) {
      throw new RpcException({
        statusCode: 500,
        message: `Rol ${rolNombre} no encontrado`,
      });
    }

    const tokenVerifEmail = randomBytes(32).toString('hex');
    const tokenVerifExp = new Date(Date.now() + VERIF_TOKEN_TTL_MS);
    const hashPassword = await bcrypt.hash(password, 10)
    const newUser = await this.prisma.usuario.create({
      data: {
        email: email,
        hashPassword: hashPassword ,
        nombre: nombre,
        telefono: telefono,
        rolId: role.id,
        tokenVerifEmail: tokenVerifEmail,
        tokenVerifExp: tokenVerifExp,
      },
    });

    await this.auditService.createLog({
      usuarioId: newUser.id,
      accion: 'REGISTER',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    this.emitEmailEvent('email.send_verification', {
      email: newUser.email,
      nombre: newUser.nombre,
      token: tokenVerifEmail,
    });

    return {
      id: newUser.id,
      email: newUser.email,
      nombre: newUser.nombre,
      message: 'Usuario registrado correctamente. Por favor verifica tu email.',
    };
  }

  /** Alta de personal del panel (Operador / Policia) — solo vía admin autorizado. */
  async createUserByAdmin(
    dto: CreateUserByAdminDto & { requestedBy: string },
  ) {
    return this.provisionPanelUser({
      email: dto.email,
      nombre: dto.nombre,
      telefono: dto.telefono,
      rolNombre: dto.rolNombre,
      requestedBy: dto.requestedBy,
    });
  }

  async bulkCreateUsersByAdmin(
    dto: BulkImportUsersDto & { requestedBy: string },
  ) {
    const parsed = parseUsersImportFile({
      format: dto.format,
      content: dto.content,
      contentBase64: dto.contentBase64,
    });
    const fileDefaultRol = dto.rolNombreDefault;

    if (parsed.errors.length > 0 && parsed.users.length === 0) {
      throw new RpcException({
        statusCode: 400,
        message: 'El archivo no pudo procesarse',
        errors: parsed.errors,
      });
    }

    const results: Array<{
      row: number;
      email: string;
      nombre: string;
      status: 'created' | 'skipped' | 'error';
      message?: string;
    }> = [];

    for (const parseError of parsed.errors) {
      results.push({
        row: parseError.row,
        email: '—',
        nombre: '—',
        status: 'error',
        message: parseError.message,
      });
    }

    let created = 0;
    let failed = parsed.errors.length;
    let skipped = 0;

    for (const row of parsed.users) {
      const rolNombre = row.rolNombre ?? fileDefaultRol;

      try {
        await this.provisionPanelUser({
          email: row.email,
          nombre: row.nombre,
          telefono: row.telefono,
          rolNombre,
          requestedBy: dto.requestedBy,
        });
        created++;
        results.push({
          row: row.row,
          email: row.email,
          nombre: row.nombre,
          status: 'created',
        });
      } catch (error) {
        const payload =
          error instanceof RpcException
            ? (error.getError() as { statusCode?: number; message?: string })
            : { message: (error as Error).message };
        const message = payload.message ?? 'No se pudo crear el usuario';

        if (payload.statusCode === 409) {
          skipped++;
          results.push({
            row: row.row,
            email: row.email,
            nombre: row.nombre,
            status: 'skipped',
            message: 'El correo ya está registrado',
          });
        } else {
          failed++;
          results.push({
            row: row.row,
            email: row.email,
            nombre: row.nombre,
            status: 'error',
            message: String(message),
          });
        }
      }
    }

    return {
      total: parsed.users.length,
      created,
      skipped,
      failed,
      defaultRol: fileDefaultRol,
      results: results.sort((a, b) => a.row - b.row),
      message:
        created > 0
          ? `Importación completada: ${created} creado(s), ${skipped} omitido(s), ${failed} error(es).`
          : 'No se creó ningún usuario.',
    };
  }

  private async provisionPanelUser(params: {
    email: string;
    nombre: string;
    telefono?: string;
    rolNombre: 'Operador' | 'Policia';
    requestedBy: string;
  }) {
    const { email, nombre, telefono, rolNombre, requestedBy } = params;

    const existingUser = await this.prisma.usuario.findUnique({ where: { email } });
    if (existingUser) {
      throw new RpcException({
        statusCode: 409,
        message: 'El correo ya está registrado',
      });
    }

    const role = await this.prisma.rol.findUnique({ where: { nombre: rolNombre } });
    if (!role) {
      throw new RpcException({
        statusCode: 500,
        message: `Rol ${rolNombre} no encontrado`,
      });
    }

    const randomPassword = randomBytes(32).toString('hex');
    const hashPassword = await bcrypt.hash(randomPassword, 10);
    const tokenResetPwd = randomBytes(32).toString('hex');
    const tokenResetExp = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    const newUser = await this.prisma.usuario.create({
      data: {
        email,
        hashPassword,
        nombre,
        telefono,
        rolId: role.id,
        emailVerificado: true,
        tokenResetPwd,
        tokenResetExp,
      },
    });

    await this.auditService.createLog({
      usuarioId: newUser.id,
      accion: 'USER_CREATED_BY_ADMIN',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
      metadata: { requestedBy, rolNombre },
    });

    this.emitEmailEvent('email.send_password_reset', {
      email: newUser.email,
      nombre: newUser.nombre,
      token: tokenResetPwd,
      expiresInMinutes: RESET_TOKEN_TTL_MIN,
    });

    return {
      id: newUser.id,
      email: newUser.email,
      nombre: newUser.nombre,
      rol: rolNombre,
      message: `Usuario ${rolNombre} creado. Se envió un correo para establecer la contraseña.`,
    };
  }

  async findUsers(filters?: { rol?: string }) {
    const rolFilter = filters?.rol?.trim();
    const allowedRoles = ['Operador', 'Policia', 'Admin'];

    const users = await this.prisma.usuario.findMany({
      where: {
        deletedAt: null,
        ...(rolFilter && allowedRoles.includes(rolFilter)
          ? { rol: { nombre: rolFilter } }
          : { rol: { nombre: { in: ['Operador', 'Policia', 'Admin'] } } }),
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        telefono: true,
        activo: true,
        emailVerificado: true,
        createdAt: true,
        rol: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      telefono: u.telefono,
      activo: u.activo,
      emailVerificado: u.emailVerificado,
      rol: u.rol.nombre,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async loginUser(loginUserDto: LoginUserDto) {
    const { email, password, ipAddress, userAgent, fcmToken, plataforma } = loginUserDto;
    const user = await this.prisma.usuario.findUnique({
      where: {
        email: email,
      },
      include:{
        rol: {
          include: {
            rolesPermisos: {
              include: { permiso: true }
            }
          }
        }
      }
    });
    if (!user) {
      throw new RpcException({
        statusCode: 401,
        message: 'Credenciales inválidas',
      });
    }

    // Verificar si la cuenta está activa o fue eliminada (soft delete)
    if (!user.activo || user.deletedAt) {
      throw new RpcException({
        statusCode: 403,
        message: 'La cuenta se encuentra desactivada. Contacte al administrador.',
      });
    }

    // 1. Verificar si la cuenta está bloqueada
    if (user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      await this.auditService.createLog({
        usuarioId: user.id,
        accion: 'LOGIN_BLOCKED',
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'Unknown',
      });
      throw new RpcException({
        statusCode: 403,
        message: `Cuenta bloqueada por múltiples intentos fallidos. Intente nuevamente a las ${user.bloqueadoHasta.toLocaleTimeString()}`,
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.hashPassword);

    if (!isPasswordValid) {
      // 2. Incrementar intentos fallidos
      const nuevosIntentos = user.intentosFallidos + 1;
      const MAX_INTENTOS = 3;
      let bloqueadoHasta: Date | null = null;

      if (nuevosIntentos >= MAX_INTENTOS) {
        bloqueadoHasta = new Date(Date.now() + 15 * 60 * 1000)  ; // 15 minutos
      }

      await this.prisma.usuario.update({
        where: { id: user.id },
        data: {
          intentosFallidos: nuevosIntentos,
          bloqueadoHasta: bloqueadoHasta,
        }
      });

      await this.auditService.createLog({
        usuarioId: user.id,
        accion: 'LOGIN_FAILED',
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'Unknown',
        metadata: { intentosFallidos: nuevosIntentos, bloqueado: nuevosIntentos >= MAX_INTENTOS }
      });

      throw new RpcException({
        statusCode: 401,
        message: nuevosIntentos >= MAX_INTENTOS 
          ? 'Cuenta bloqueada por múltiples intentos fallidos. Espere 15 minutos.' 
          : 'Credenciales inválidas',
      });
    }

    // 3. Resetear contadores y actualizar último login
    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        intentosFallidos: 0,
        bloqueadoHasta: null,
        ultimoLogin: new Date(),
      }
    });

    const permisos = user.rol.rolesPermisos.map(rp => `${rp.permiso.modulo}:${rp.permiso.accion}`);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      rol: user.rol.nombre,
      permisos: permisos
    }

    const token = await this.generateToken(payload);

    // Generar refresh token de 64 caracteres hex
    const refreshToken = randomBytes(32).toString('hex');
    const expiraEn = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // Expira en 7 días

    // Registrar la sesión en la base de datos
    await this.prisma.sesion.create({
      data: {
        usuarioId: user.id,
        refreshToken,
        userAgent: userAgent || 'Unknown',
        ipAddress: ipAddress || '127.0.0.1',
        expiraEn,
      },
    });

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'LOGIN_SUCCESS',
      ipAddress: ipAddress || '127.0.0.1',
      userAgent: userAgent || 'Unknown',
    });

    if (fcmToken) {
      await this.dispositivosService.registerFcmToken(
        user.id,
        fcmToken,
        plataforma || 'android',
      );
    }

    return {
      accessToken: token,
      refreshToken,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol.nombre
      },
      message: 'Sesion iniciada',
    };
  }

  async refreshUserToken(tokenDto: {
    refreshToken: string;
    ipAddress?: string;
    userAgent?: string;
    fcmToken?: string;
    plataforma?: string;
  }) {
    const { refreshToken, ipAddress, userAgent, fcmToken, plataforma } = tokenDto;

    // Buscar la sesión y el usuario correspondiente
    const session = await this.prisma.sesion.findUnique({
      where: { refreshToken },
      include: {
        usuario: {
          include: { 
            rol: {
              include: {
                rolesPermisos: { include: { permiso: true } }
              }
            } 
          }
        }
      }
    });

    if (!session || !session.activa || session.expiraEn < new Date() || session.revocadaEn) {
      throw new RpcException({
        statusCode: 401,
        message: 'Sesión inválida o expirada',
      });
    }

    // Rotación del Refresh Token (Seguridad - Evita replay attacks)
    const newRefreshToken = randomBytes(32).toString('hex');
    const newExpiraEn = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 días

    // Invalidar sesión anterior y crear una nueva sesión rotada
    await this.prisma.$transaction([
      this.prisma.sesion.update({
        where: { id: session.id },
        data: {
          activa: false,
          revocadaEn: new Date(),
        }
      }),
      this.prisma.sesion.create({
        data: {
          usuarioId: session.usuarioId,
          refreshToken: newRefreshToken,
          userAgent: userAgent || session.userAgent,
          ipAddress: ipAddress || session.ipAddress,
          expiraEn: newExpiraEn,
        }
      })
    ]);

    const permisos = session.usuario.rol.rolesPermisos.map(rp => `${rp.permiso.modulo}:${rp.permiso.accion}`);

    const payload: JwtPayload = {
      sub: session.usuario.id,
      email: session.usuario.email,
      rol: session.usuario.rol.nombre,
      permisos: permisos
    };

    const accessToken = await this.generateToken(payload);

    if (fcmToken) {
      await this.dispositivosService.registerFcmToken(
        session.usuarioId,
        fcmToken,
        plataforma || 'android',
      );
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: session.usuario.id,
        nombre: session.usuario.nombre,
        email: session.usuario.email,
        rol: session.usuario.rol.nombre
      }
    };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { token } = verifyEmailDto;

    const user = await this.prisma.usuario.findFirst({
      where: { tokenVerifEmail: token }
    });

    if (!user) {
      throw new RpcException({
        statusCode: 400,
        message: 'Token de verificación inválido o expirado',
      });
    }

    // El token de verificación puede haber expirado (los emitidos sin expiración antigua se tratan como válidos)
    if (user.tokenVerifExp && user.tokenVerifExp < new Date()) {
      throw new RpcException({
        statusCode: 400,
        message: 'El enlace de verificación ha expirado. Solicita uno nuevo.',
      });
    }

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        emailVerificado: true,
        tokenVerifEmail: null,
        tokenVerifExp: null,
      }
    });

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'EMAIL_VERIFIED',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    return {
      message: 'Email verificado correctamente',
    };
  }

  async resendVerification(resendVerificationDto: ResendVerificationDto) {
    const { email } = resendVerificationDto;
    const neutralResponse = {
      message: 'Si el correo existe y aún no está verificado, te enviamos un nuevo enlace.',
    };

    const user = await this.prisma.usuario.findUnique({ where: { email } });

    // Respuesta neutra: no revelamos si el correo existe o ya está verificado
    if (!user || user.deletedAt || user.emailVerificado) {
      return neutralResponse;
    }

    const tokenVerifEmail = randomBytes(32).toString('hex');
    const tokenVerifExp = new Date(Date.now() + VERIF_TOKEN_TTL_MS);

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: { tokenVerifEmail, tokenVerifExp },
    });

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'EMAIL_VERIFICATION_RESENT',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    this.emitEmailEvent('email.send_verification', {
      email: user.email,
      nombre: user.nombre,
      token: tokenVerifEmail,
    });

    return neutralResponse;
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.prisma.usuario.findUnique({
      where: { email }
    });

    if (!user) {
      // Por seguridad, siempre devolvemos mensaje de éxito aunque no exista
      return { message: 'Si el correo existe, se ha enviado un token de recuperación.' };
    }

    const tokenResetPwd = randomBytes(32).toString('hex');
    const tokenResetExp = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        tokenResetPwd,
        tokenResetExp,
      }
    });

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'PASSWORD_RESET_REQUESTED',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    this.emitEmailEvent('email.send_password_reset', {
      email: user.email,
      nombre: user.nombre,
      token: tokenResetPwd,
      expiresInMinutes: RESET_TOKEN_TTL_MIN,
    });

    return {
      message: 'Si el correo existe, se ha enviado un token de recuperación.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;

    const user = await this.prisma.usuario.findFirst({
      where: {
        tokenResetPwd: token,
        tokenResetExp: {
          gt: new Date() // El token debe no haber expirado
        }
      }
    });

    if (!user) {
      throw new RpcException({
        statusCode: 400,
        message: 'Token inválido o expirado',
      });
    }

    const hashPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar clave, limpiar tokens y revocar todas las sesiones existentes por seguridad
    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: user.id },
        data: {
          hashPassword,
          tokenResetPwd: null,
          tokenResetExp: null,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        }
      }),
      this.prisma.sesion.updateMany({
        where: { usuarioId: user.id, activa: true },
        data: {
          activa: false,
          revocadaEn: new Date(),
        }
      })
    ]);

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'PASSWORD_RESET_SUCCESS',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    return {
      message: 'Contraseña actualizada correctamente',
    };
  }

  async changePassword(data: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    const { userId, currentPassword, newPassword } = data;

    const user = await this.prisma.usuario.findUnique({
      where: { id: userId },
    });

    if (!user || !user.activo) {
      throw new RpcException({
        statusCode: 404,
        message: 'Usuario no encontrado',
      });
    }

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.hashPassword,
    );

    if (!isCurrentValid) {
      throw new RpcException({
        statusCode: 401,
        message: 'La contraseña actual es incorrecta',
      });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.hashPassword);
    if (isSamePassword) {
      throw new RpcException({
        statusCode: 400,
        message: 'La nueva contraseña debe ser distinta a la actual',
      });
    }

    const hashPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        hashPassword,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });

    await this.auditService.createLog({
      usuarioId: user.id,
      accion: 'PASSWORD_CHANGED',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    return {
      message: 'Contraseña actualizada correctamente',
    };
  }

  async registerFcmTokenForUser(data: {
    userId: string;
    fcmToken: string;
    plataforma?: string;
  }) {
    await this.dispositivosService.registerFcmToken(
      data.userId,
      data.fcmToken,
      data.plataforma || 'android',
    );

    return { message: 'FCM registrado' };
  }

  async logoutUser(dto: { refreshToken: string; fcmToken?: string }) {
    const { refreshToken, fcmToken } = dto;
    const session = await this.prisma.sesion.findUnique({
      where: { refreshToken }
    });

    if (!session) {
      throw new RpcException({
        statusCode: 404,
        message: 'Sesión no encontrada',
      });
    }

    await this.prisma.sesion.update({
      where: { id: session.id },
      data: {
        activa: false,
        revocadaEn: new Date(),
      }
    });

    await this.auditService.createLog({
      usuarioId: session.usuarioId,
      accion: 'LOGOUT',
      ipAddress: session.ipAddress, // Guardado en la sesión
      userAgent: session.userAgent,
    });

    if (fcmToken) {
      await this.dispositivosService.deactivateFcmToken(fcmToken);
    }

    return {
      message: 'Sesión cerrada correctamente',
    };
  }


  async deactivateUser(userId: string, requestedBy: string) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new RpcException({
        statusCode: 404,
        message: 'Usuario no encontrado',
      });
    }

    if (user.deletedAt) {
      throw new RpcException({
        statusCode: 400,
        message: 'El usuario ya fue dado de baja',
      });
    }

    const isSelfDelete = userId === requestedBy;
    const anonymizedEmail = `deleted_${userId}@centinela.invalid`;
    const anonymizedPassword = await bcrypt.hash(
      randomBytes(32).toString('hex'),
      10,
    );

    // Soft delete + desactivar + revocar todas las sesiones
    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: userId },
        data: {
          activo: false,
          deletedAt: new Date(),
          ...(isSelfDelete
            ? {
                email: anonymizedEmail,
                nombre: 'Usuario eliminado',
                telefono: null,
                hashPassword: anonymizedPassword,
                tokenVerifEmail: null,
                tokenResetPwd: null,
                intentosFallidos: 0,
                bloqueadoHasta: null,
              }
            : {}),
        }
      }),
      this.prisma.sesion.updateMany({
        where: { usuarioId: userId, activa: true },
        data: {
          activa: false,
          revocadaEn: new Date(),
        }
      })
    ]);

    await this.auditService.createLog({
      usuarioId: userId,
      accion: isSelfDelete ? 'USER_SELF_DELETED' : 'USER_DEACTIVATED',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
      metadata: { requestedBy, isSelfDelete }
    });

    return {
      message: isSelfDelete
        ? 'Cuenta y datos personales eliminados correctamente'
        : 'Usuario dado de baja correctamente (soft delete)',
    };
  }

  async getUsersRoles(userIds: string[]) {
    const users = await this.prisma.usuario.findMany({
      where: { id: { in: userIds } },
      include: { rol: true }
    });
    
    return users.map(u => ({
      usuarioId: u.id,
      rol: u.rol.nombre.toLowerCase() // 'ciudadano', 'operador', 'admin'
    }));
  }

  /** Usuarios del panel web que reciben push OneSignal (Admin, Operador, Policia). */
  async getWebPushRecipients() {
    const users = await this.prisma.usuario.findMany({
      where: {
        deletedAt: null,
        emailVerificado: true,
        rol: {
          nombre: { in: ['Admin', 'Operador', 'Policia'] },
        },
      },
      select: {
        id: true,
        rol: { select: { nombre: true } },
      },
    });

    return users.map((u) => ({
      usuarioId: u.id,
      rol: u.rol.nombre.toLowerCase(),
    }));
  }
}

