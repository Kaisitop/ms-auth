import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DispositivosService } from './dispositivos.service';

@Controller()
export class DispositivosController {
  constructor(private readonly dispositivosService: DispositivosService) {}

  @MessagePattern('dispositivos.get_fcm_tokens_by_users')
  getFcmTokensByUsers(@Payload() userIds: string[]) {
    return this.dispositivosService.getFcmTokensByUserIds(userIds);
  }

  @MessagePattern('dispositivos.deactivate_fcm_token')
  deactivateFcmToken(@Payload() payload: { fcmToken: string }) {
    return this.dispositivosService.deactivateFcmToken(payload.fcmToken);
  }
}
