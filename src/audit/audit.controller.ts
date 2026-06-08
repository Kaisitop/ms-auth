import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AuditService, CreateAuditLogDto } from './audit.service';

@Controller()
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  @EventPattern('audit.log.create')
  async handleAuditLogCreate(@Payload() data: CreateAuditLogDto) {
    this.logger.log(`Received audit log event: ${data.accion} from IP: ${data.ipAddress}`);
    await this.auditService.createLog(data);
  }
}
