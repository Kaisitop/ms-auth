import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateUserByAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsIn(['Operador', 'Policia'])
  rolNombre: 'Operador' | 'Policia';
}
