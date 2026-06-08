import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}
