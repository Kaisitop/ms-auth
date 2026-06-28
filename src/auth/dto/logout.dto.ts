import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;

  @IsString()
  @IsOptional()
  fcmToken?: string;
}
