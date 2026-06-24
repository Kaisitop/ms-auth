import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { envs } from '../src/config/envs';


const adapter = new PrismaPg({
  connectionString: envs.dataBaseUrl!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {

  await prisma.rol.createMany({
    data: [
      {
        nombre: 'Admin',
        descripcion: 'Administrador del sistema',
      },
      {
        nombre: 'Operador',
        descripcion: 'Operador del sistema',
      },
      {
        nombre: 'Ciudadano',
        descripcion: 'Usuario ciudadano',
      },
    ],
    skipDuplicates: true,
  });

  // Roles
  const roles = await prisma.rol.findMany();
  let adminRol = roles.find(r => r.nombre === 'Admin');
  let operadorRol = roles.find(r => r.nombre === 'Operador');
  const ciudadanoRol = roles.find(r => r.nombre === 'Ciudadano');
  
  console.log('Roles creados/verificados correctamente');

  // Permisos
  const permisosData = [
    { modulo: 'usuarios', accion: 'crear', descripcion: 'Crear usuarios' },
    { modulo: 'usuarios', accion: 'leer', descripcion: 'Leer usuarios' },
    { modulo: 'usuarios', accion: 'actualizar', descripcion: 'Actualizar usuarios' },
    { modulo: 'usuarios', accion: 'eliminar', descripcion: 'Eliminar usuarios' },
    { modulo: 'reportes', accion: 'ver', descripcion: 'Ver reportes' },
    // Permisos del core
    { modulo: 'zonas', accion: 'gestionar', descripcion: 'Crear, editar o eliminar zonas' },
    { modulo: 'zonas', accion: 'leer', descripcion: 'Ver zonas' },
    { modulo: 'nodos', accion: 'gestionar', descripcion: 'Crear, editar o eliminar nodos' },
    { modulo: 'nodos', accion: 'leer', descripcion: 'Ver nodos' },
    { modulo: 'eventos', accion: 'gestionar', descripcion: 'Gestionar eventos y alertas' },
    { modulo: 'eventos', accion: 'leer', descripcion: 'Ver eventos y alertas' },
  ];

  await prisma.permiso.createMany({
    data: permisosData,
    skipDuplicates: true,
  });
  console.log('Permisos creados correctamente');

  const permisos = await prisma.permiso.findMany();

  if (adminRol) {
    const rolesPermisosAdmin = permisos.map(p => ({
      rolId: adminRol.id,
      permisoId: p.id,
    }));
    await prisma.rolPermiso.createMany({
      data: rolesPermisosAdmin,
      skipDuplicates: true,
    });
  }

  if (operadorRol) {
    // Operador solo puede leer y gestionar eventos/reportes (no usuarios)
    const permisosOperador = permisos.filter(p => 
      ['leer', 'ver'].includes(p.accion) || 
      ['eventos'].includes(p.modulo)
    );
    const rolesPermisosOperador = permisosOperador.map(p => ({
      rolId: operadorRol.id,
      permisoId: p.id,
    }));
    await prisma.rolPermiso.createMany({
      data: rolesPermisosOperador,
      skipDuplicates: true,
    });
  }

  if (ciudadanoRol) {
    // Ciudadano: crear y consultar sus reportes / SOS (app móvil)
    const permisosCiudadano = permisos.filter(
      (p) => p.modulo === 'eventos' && ['gestionar', 'leer'].includes(p.accion),
    );
    await prisma.rolPermiso.createMany({
      data: permisosCiudadano.map((p) => ({
        rolId: ciudadanoRol.id,
        permisoId: p.id,
      })),
      skipDuplicates: true,
    });
  }

  console.log('Permisos asignados a roles correctamente');

  // Crear usuarios de prueba
  const bcrypt = require('bcrypt');
  const hashAdmin = await bcrypt.hash('Admin123!', 10);
  const hashOperador = await bcrypt.hash('Operador123!', 10);

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
      }
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
      }
    });
  }

  console.log('Usuarios admin@centinela.com y operador@centinela.com creados.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });