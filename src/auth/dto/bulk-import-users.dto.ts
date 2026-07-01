import { IsIn, IsOptional, IsString } from 'class-validator';

export class BulkImportUsersDto {
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx';

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  contentBase64?: string;

  @IsIn(['Operador', 'Policia'])
  rolNombreDefault: 'Operador' | 'Policia';
}
