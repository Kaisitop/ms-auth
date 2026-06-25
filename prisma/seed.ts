import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { envs } from '../src/config/envs';

const adapter = new PrismaPg({
  connectionString: envs.dataBaseUrl!,
});

const prisma = new PrismaClient({
  adapter,
});

type PermisoDef = { modulo: string; accion: string; descripcion: string };

/** Catálogo completo modulo:accion */
const PERMISOS_CATALOG: PermisoDef[] = [
  // ── Admin: identidad ──
  { modulo: 'usuarios', accion: 'create', descripcion: 'Crear usuarios' },
  { modulo: 'usuarios', accion: 'read', descripcion: 'Consultar usuarios' },
  { modulo: 'usuarios', accion: 'update', descripcion: 'Actualizar o desactivar usuarios' },
  { modulo: 'roles', accion: 'manage', descripcion: 'Administrar roles' },
  { modulo: 'permisos', accion: 'manage', descripcion: 'Administrar permisos' },
  { modulo: 'auditoria', accion: 'read', descripcion: 'Consultar auditoría' },
  { modulo: 'sesiones', accion: 'manage', descripcion: 'Gestionar sesiones activas' },

  // ── Admin: infra IoT / zonas ──
  { modulo: 'nodos', accion: 'create', descripcion: 'Registrar nodos IoT' },
  { modulo: 'nodos', accion: 'read', descripcion: 'Consultar nodos IoT' },
  { modulo: 'nodos', accion: 'update', descripcion: 'Actualizar nodos IoT' },
  { modulo: 'nodos', accion: 'delete', descripcion: 'Eliminar nodos IoT' },
  { modulo: 'zonas', accion: 'create', descripcion: 'Crear zonas geográficas' },
  { modulo: 'zonas', accion: 'update', descripcion: 'Actualizar zonas geográficas' },
  { modulo: 'zonas', accion: 'read', descripcion: 'Consultar zonas geográficas' },
  { modulo: 'rutas', accion: 'create', descripcion: 'Crear rutas de patrullaje' },
  { modulo: 'rutas', accion: 'read', descripcion: 'Consultar rutas de patrullaje' },

  // ── Admin troubleshooting (datos completos) ──
  { modulo: 'eventos', accion: 'read_all', descripcion: 'Ver todos los eventos (troubleshooting)' },
  { modulo: 'reportes', accion: 'read_all', descripcion: 'Ver todos los reportes con PII (troubleshooting)' },
  { modulo: 'alertas', accion: 'read_all', descripcion: 'Ver todas las alertas (troubleshooting)' },

  // ── Operador: eventos / audio ──
  { modulo: 'eventos', accion: 'read', descripcion: 'Consultar eventos del turno' },
  { modulo: 'eventos', accion: 'listen', descripcion: 'Acceso a clips de audio temporales' },
  { modulo: 'eventos', accion: 'create', descripcion: 'Registrar eventos manuales' },

  // ── Operador: reportes / alertas ──
  { modulo: 'reportes', accion: 'read_anon', descripcion: 'Ver reportes sin datos personales' },
  { modulo: 'reportes', accion: 'update', descripcion: 'Actualizar estado y notas de reportes' },
  { modulo: 'alertas', accion: 'read', descripcion: 'Consultar alertas operativas' },
  { modulo: 'alertas', accion: 'create', descripcion: 'Crear alertas manuales' },
  { modulo: 'alertas', accion: 'update_status', descripcion: 'Reconocer, cerrar o completar alertas' },

  // ── Operador: notificaciones ──
  { modulo: 'notificaciones', accion: 'send', descripcion: 'Enviar notificaciones a destinatarios' },

  // ── Patrulla (Policia) ──
  { modulo: 'analytics', accion: 'heat_map', descripcion: 'Mapa de calor de eventos IA' },
  { modulo: 'patrullaje', accion: 'update_position', descripcion: 'Reportar posición GPS en patrulla' },
  { modulo: 'patrullaje', accion: 'read_positions', descripcion: 'Ver posiciones activas de patrulleros' },

  // ── Ciudadano (app móvil) ──
  { modulo: 'reportes', accion: 'create', descripcion: 'Crear reportes ciudadanos' },
  { modulo: 'reportes', accion: 'read_own', descripcion: 'Consultar reportes propios' },
];

/** Permisos explícitos del operador (según MER) */
const OPERADOR_PERMISSIONS = [
  'eventos:read',
  'eventos:listen',
  'eventos:create',
  'reportes:read_anon',
  'reportes:update',
  'alertas:read',
  'alertas:create',
  'alertas:update_status',
  'zonas:read',
  'rutas:read',
  'nodos:read',
  'notificaciones:send',
  'patrullaje:read_positions',
];

/** Permisos explícitos del admin (según MER) */
const ADMIN_PERMISSIONS = [
  'usuarios:create',
  'usuarios:read',
  'usuarios:update',
  'roles:manage',
  'permisos:manage',
  'auditoria:read',
  'sesiones:manage',
  'nodos:create',
  'nodos:read',
  'nodos:update',
  'nodos:delete',
  'zonas:create',
  'zonas:update',
  'rutas:create',
  'eventos:read_all',
  'reportes:read_all',
  'alertas:read_all',
  // Admin también opera el dashboard completo
  ...OPERADOR_PERMISSIONS,
  'zonas:read',
  'rutas:read',
  'analytics:heat_map',
];

const POLICIA_PERMISSIONS = [
  'alertas:read',
  'alertas:update_status',
  'reportes:read_anon',
  'analytics:heat_map',
  'patrullaje:update_position',
];

const CIUDADANO_PERMISSIONS = ['reportes:create', 'reportes:read_own'];

async function assignPermissions(rolId: string, keys: string[], permisos: { id: string; modulo: string; accion: string }[]) {
  const rows = permisos
    .filter((p) => keys.includes(`${p.modulo}:${p.accion}`))
    .map((p) => ({ rolId, permisoId: p.id }));

  if (rows.length === 0) return;

  await prisma.rolPermiso.createMany({
    data: rows,
    skipDuplicates: true,
  });
}

async function main() {
  await prisma.rol.createMany({
    data: [
      { nombre: 'Admin', descripcion: 'Administrador del sistema' },
      { nombre: 'Operador', descripcion: 'Operador del centro de comando' },
      { nombre: 'Ciudadano', descripcion: 'Usuario ciudadano (app móvil)' },
      { nombre: 'Policia', descripcion: 'Patrullero — vista móvil de mapa y cierre de alertas' },
    ],
    skipDuplicates: true,
  });

  const roles = await prisma.rol.findMany();
  const adminRol = roles.find((r) => r.nombre === 'Admin');
  const operadorRol = roles.find((r) => r.nombre === 'Operador');
  const ciudadanoRol = roles.find((r) => r.nombre === 'Ciudadano');
  const policiaRol = roles.find((r) => r.nombre === 'Policia');

  await prisma.permiso.createMany({
    data: PERMISOS_CATALOG,
    skipDuplicates: true,
  });

  const permisos = await prisma.permiso.findMany();
  console.log(`Permisos en catálogo: ${permisos.length}`);

  // Reasignar permisos por rol (idempotente tras skipDuplicates en rolPermiso)
  await prisma.rolPermiso.deleteMany({});

  if (adminRol) {
    await assignPermissions(adminRol.id, ADMIN_PERMISSIONS, permisos);
    console.log(`Admin: ${ADMIN_PERMISSIONS.length} permisos asignados`);
  }

  if (operadorRol) {
    await assignPermissions(operadorRol.id, OPERADOR_PERMISSIONS, permisos);
    console.log(`Operador: ${OPERADOR_PERMISSIONS.length} permisos asignados`);
  }

  if (policiaRol) {
    await assignPermissions(policiaRol.id, POLICIA_PERMISSIONS, permisos);
  }

  if (ciudadanoRol) {
    await assignPermissions(ciudadanoRol.id, CIUDADANO_PERMISSIONS, permisos);
  }

  const bcrypt = require('bcrypt');
  const hashAdmin = await bcrypt.hash('Admin123!', 10);
  const hashOperador = await bcrypt.hash('Operador123!', 10);
  const hashPolicia = await bcrypt.hash('Policia123!', 10);

  if (adminRol) {
    await prisma.usuario.upsert({
      where: { email: 'admin@centinela.com' },
      update: {},
      create: {
        email: 'admin@centinela.com',
        nombre: 'Admin General',
        hashPassword: hashAdmin,
        rolId: adminRol.id,
        emailVerificado: true,
      },
    });
  }

  if (operadorRol) {
    await prisma.usuario.upsert({
      where: { email: 'operador@centinela.com' },
      update: {},
      create: {
        email: 'operador@centinela.com',
        nombre: 'Operador Principal',
        hashPassword: hashOperador,
        rolId: operadorRol.id,
        emailVerificado: true,
      },
    });
  }

  if (policiaRol) {
    await prisma.usuario.upsert({
      where: { email: 'policia@centinela.com' },
      update: {},
      create: {
        email: 'policia@centinela.com',
        nombre: 'Patrullero Piloto',
        hashPassword: hashPolicia,
        rolId: policiaRol.id,
        emailVerificado: true,
      },
    });
  }

  console.log('Seed de permisos y usuarios completado.');
  console.log('IMPORTANTE: los usuarios deben cerrar sesión y volver a entrar para refrescar permisos en el JWT.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
