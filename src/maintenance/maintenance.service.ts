import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';

export const SEED_PANEL_EMAILS = [
  'admin@centinela.com',
  'operador@centinela.com',
  'policia@centinela.com',
] as const;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeUsers(requestedBy?: string) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'TRUNCATE TABLE identity.audit_log RESTART IDENTITY',
        );

        const removed = await tx.usuario.deleteMany({
          where: {
            email: { notIn: [...SEED_PANEL_EMAILS] },
          },
        });

        const kept = await tx.usuario.count({
          where: { email: { in: [...SEED_PANEL_EMAILS] } },
        });

        return {
          usuariosEliminados: removed.count,
          usuariosConservados: kept,
          auditLogsEliminados: 'all',
        };
      });

      this.logger.warn(
        `Purge usuarios ejecutado${requestedBy ? ` por ${requestedBy}` : ''}: ${JSON.stringify(result)}`,
      );

      return {
        message:
          'Usuarios extra eliminados. Se conservaron admin, operador y policía por defecto.',
        deleted: result,
        seedEmails: SEED_PANEL_EMAILS,
      };
    } catch (error) {
      this.logger.error('Error al purgar usuarios', error);
      throw new RpcException({
        status: 500,
        message: 'No se pudo limpiar los usuarios',
      });
    }
  }
}
