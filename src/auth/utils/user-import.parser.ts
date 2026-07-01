import * as XLSX from 'xlsx';

export type PanelRolNombre = 'Operador' | 'Policia';

export interface ParsedImportUser {
  row: number;
  nombre: string;
  email: string;
  telefono?: string;
  rolNombre?: PanelRolNombre;
}

export interface ParseImportResult {
  users: ParsedImportUser[];
  errors: Array<{ row: number; message: string }>;
}

const HEADER_ALIASES: Record<string, keyof ParsedImportUser | 'ignore'> = {
  nombre: 'nombre',
  name: 'nombre',
  email: 'email',
  correo: 'email',
  telefono: 'telefono',
  teléfono: 'telefono',
  phone: 'telefono',
  rol: 'rolNombre',
  role: 'rolNombre',
};

const MAX_ROWS = 500;

function normalizeRol(value?: string | null): PanelRolNombre | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'operador') return 'Operador';
  if (v === 'policia' || v === 'policía') return 'Policia';
  return undefined;
}

function mapHeaderKey(raw: string): keyof ParsedImportUser | null {
  const key = raw.trim().toLowerCase();
  const mapped = HEADER_ALIASES[key];
  if (!mapped || mapped === 'ignore') return null;
  return mapped;
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function buildUserFromFields(
  row: number,
  fields: Partial<ParsedImportUser>,
  errors: ParseImportResult['errors'],
): ParsedImportUser | null {
  if (!fields.nombre?.trim() && !fields.email?.trim()) {
    return null;
  }

  if (!fields.nombre?.trim()) {
    errors.push({ row, message: 'Nombre requerido' });
    return null;
  }
  if (!fields.email?.trim()) {
    errors.push({ row, message: 'Email requerido' });
    return null;
  }

  return {
    row,
    nombre: fields.nombre.trim(),
    email: fields.email.trim().toLowerCase(),
    telefono: fields.telefono?.trim() || undefined,
    rolNombre: fields.rolNombre,
  };
}

function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}

export function parseUsersCsv(content: string): ParseImportResult {
  const errors: ParseImportResult['errors'] = [];
  const users: ParsedImportUser[] = [];

  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { users, errors: [{ row: 0, message: 'El archivo CSV está vacío' }] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => mapHeaderKey(h));

  if (!headers.includes('nombre') || !headers.includes('email')) {
    return {
      users,
      errors: [
        {
          row: 1,
          message: 'El CSV debe incluir columnas nombre y email (o name / correo)',
        },
      ],
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    return {
      users,
      errors: [{ row: 0, message: `Máximo ${MAX_ROWS} filas por importación` }],
    };
  }

  dataLines.forEach((line, index) => {
    const row = index + 2;
    const values = parseCsvLine(line, delimiter);
    const record: Partial<ParsedImportUser> = {};

    headers.forEach((field, colIndex) => {
      if (!field) return;
      const value = values[colIndex]?.trim();
      if (!value) return;
      if (field === 'rolNombre') {
        const rol = normalizeRol(value);
        if (!rol) {
          errors.push({ row, message: `Rol inválido: ${value}` });
        } else {
          record.rolNombre = rol;
        }
      } else {
        record[field] = value as never;
      }
    });

    const user = buildUserFromFields(row, record, errors);
    if (user) users.push(user);
  });

  return { users, errors };
}

export function parseUsersXlsx(buffer: Buffer): ParseImportResult {
  const errors: ParseImportResult['errors'] = [];
  const users: ParsedImportUser[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return {
      users,
      errors: [{ row: 0, message: 'No se pudo leer el archivo Excel (.xlsx / .xls)' }],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { users, errors: [{ row: 0, message: 'El archivo Excel no tiene hojas' }] };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: '', raw: false },
  );

  if (rows.length === 0) {
    return { users, errors: [{ row: 0, message: 'La hoja de Excel está vacía' }] };
  }

  const fieldByHeader = new Map<string, keyof ParsedImportUser>();
  for (const key of Object.keys(rows[0])) {
    const field = mapHeaderKey(key);
    if (field) fieldByHeader.set(key, field);
  }

  const mappedFields = [...fieldByHeader.values()];
  if (!mappedFields.includes('nombre') || !mappedFields.includes('email')) {
    return {
      users,
      errors: [
        {
          row: 1,
          message:
            'El Excel debe incluir columnas nombre y email (o name / correo) en la primera fila',
        },
      ],
    };
  }

  if (rows.length > MAX_ROWS) {
    return {
      users,
      errors: [{ row: 0, message: `Máximo ${MAX_ROWS} filas por importación` }],
    };
  }

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const record: Partial<ParsedImportUser> = {};

    for (const [header, field] of fieldByHeader) {
      const value = cellToString(row[header]);
      if (!value) continue;
      if (field === 'rolNombre') {
        const rol = normalizeRol(value);
        if (!rol) {
          errors.push({ row: rowNum, message: `Rol inválido: ${value}` });
        } else {
          record.rolNombre = rol;
        }
      } else {
        record[field] = value as never;
      }
    }

    const user = buildUserFromFields(rowNum, record, errors);
    if (user) users.push(user);
  });

  return { users, errors };
}

export function parseUsersImportFile(params: {
  format: 'csv' | 'xlsx';
  content?: string;
  contentBase64?: string;
}): ParseImportResult {
  if (params.format === 'xlsx') {
    if (!params.contentBase64) {
      return {
        users: [],
        errors: [{ row: 0, message: 'Contenido Excel inválido' }],
      };
    }
    return parseUsersXlsx(Buffer.from(params.contentBase64, 'base64'));
  }

  if (!params.content?.trim()) {
    return {
      users: [],
      errors: [{ row: 0, message: 'El archivo CSV está vacío' }],
    };
  }

  return parseUsersCsv(params.content);
}
