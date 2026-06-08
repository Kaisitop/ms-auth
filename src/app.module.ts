import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
