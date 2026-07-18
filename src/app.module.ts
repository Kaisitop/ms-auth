import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [AuthModule, AuditModule, MaintenanceModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
