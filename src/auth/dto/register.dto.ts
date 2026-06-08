import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsStrongPassword,
} from 'class-validator';

export class RegisterUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @IsStrongPassword()
  password: string;

  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  telefono?: string;
}
