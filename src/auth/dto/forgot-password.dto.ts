import { IsEmail, IsIn, IsNotEmpty, IsOptional } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /** `web` = panel Centinela; `app` = app móvil ciudadana. */
  @IsOptional()
  @IsIn(['web', 'app'])
  channel?: 'web' | 'app';
}
