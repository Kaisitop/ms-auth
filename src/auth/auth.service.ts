import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginUserDto, RegisterUserDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import * as bcrypt from 'bcrypt';

import { RpcException } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces/payload.interface';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService,
    private jwtService : JwtService,
    private readonly auditService: AuditService
  ) {}
  
  async generateToken(jwtPayload: JwtPayload){
    return await this.jwtService.signAsync(jwtPayload)
  }

  async registerUser(registerUserDto: RegisterUserDto) {
    const { email, password, nombre, telefono } = registerUserDto;

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
      where: { nombre: 'Ciudadano' },
    });

    if (!role) {
      throw new RpcException({
        statusCode: 500,
        message: 'Rol Ciudadano no encontrado',
      });
    }

    const tokenVerifEmail = randomBytes(32).toString('hex');
    const hashPassword = await bcrypt.hash(password, 10)
    const newUser = await this.prisma.usuario.create({
      data: {
        email: email,
        hashPassword: hashPassword ,
        nombre: nombre,
        telefono: telefono,
        rolId: role.id,
        tokenVerifEmail: tokenVerifEmail,
      },
    });

    await this.auditService.createLog({
      usuarioId: newUser.id,
      accion: 'REGISTER',
      ipAddress: '127.0.0.1',
      userAgent: 'Unknown',
    });

    return {
      id: newUser.id,
      email: newUser.email,
      nombre: newUser.nombre,
      tokenVerifEmail: tokenVerifEmail, // Devuelto para pruebas sin envío de email
      message: 'Usuario registrado correctamente. Por favor verifica tu email.',
    };
  }

  async loginUser(loginUserDto: LoginUserDto) {
    const { email, password, ipAddress, userAgent } = loginUserDto;
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

    return {
      accessToken: token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        rol: user.rol.nombre
      },
      message: 'Sesion iniciada',
    };
  }

  async refreshUserToken(tokenDto: { refreshToken: string; ipAddress?: string; userAgent?: string }) {
    const { refreshToken, ipAddress, userAgent } = tokenDto;

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

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: session.usuario.id,
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

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        emailVerificado: true,
        tokenVerifEmail: null,
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
    const tokenResetExp = new Date(Date.now() + 1000 * 60 * 60); // 1 hora

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

    return {
      tokenResetPwd, // Devuelto para pruebas
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

  async logoutUser(refreshToken: string) {
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

