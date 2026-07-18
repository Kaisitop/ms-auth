import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MaintenanceService } from './maintenance.service';

@Controller()
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @MessagePattern('maintenance.purgeUsers')
  purgeUsers(@Payload() payload?: { requestedBy?: string }) {
    return this.maintenanceService.purgeUsers(payload?.requestedBy);
  }
}
