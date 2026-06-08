import { IsNotEmpty, IsString, IsStrongPassword, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @IsStrongPassword()
  newPassword: string;
}
