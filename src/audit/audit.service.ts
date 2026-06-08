import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class CreateAuditLogDto {
  usuarioId?: string;
  accion: string;
  ipAddress: string;
  userAgent: string;
  metadata?: any;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createLog(data: CreateAuditLogDto) {
    try {
      await this.prisma.auditLog.create({
        data: {
          usuarioId: data.usuarioId,
          accion: data.accion,
          ipAddress: data.ipAddress || '0.0.0.0',
          userAgent: data.userAgent || 'Unknown',
          metadata: data.metadata || null,
        },
      });
    } catch (error) {
      this.logger.error(`Error saving audit log: ${error.message}`, error.stack);
    }
  }
}
