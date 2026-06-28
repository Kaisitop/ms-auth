import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DispositivosService {
  constructor(private readonly prisma: PrismaService) {}

  async registerFcmToken(
    usuarioId: string,
    fcmToken: string,
    plataforma = 'android',
  ): Promise<void> {
    const token = fcmToken?.trim();
    if (!token) return;

    await this.prisma.dispositivo.upsert({
      where: { fcmToken: token },
      update: {
        usuarioId,
        plataforma,
        activo: true,
      },
      create: {
        usuarioId,
        fcmToken: token,
        plataforma,
        activo: true,
      },
    });
  }

  async deactivateFcmToken(fcmToken: string): Promise<void> {
    const token = fcmToken?.trim();
    if (!token) return;

    await this.prisma.dispositivo.updateMany({
      where: { fcmToken: token },
      data: { activo: false },
    });
  }

  async getFcmTokensByUserIds(
    userIds: string[],
  ): Promise<{ usuarioId: string; fcmToken: string }[]> {
    if (!userIds?.length) return [];

    return this.prisma.dispositivo.findMany({
      where: {
        usuarioId: { in: userIds },
        activo: true,
      },
      select: {
        usuarioId: true,
        fcmToken: true,
      },
    });
  }
}
