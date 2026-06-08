import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { envs } from '../config/envs';
import { AuditModule } from '../audit/audit.module';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  imports: [
    PrismaModule,
    JwtModule.register({
      global: true,
      secret: envs.jwtService,
      signOptions: { expiresIn: '1h' },
    }),
    AuditModule,
  ],
})
export class AuthModule {}
