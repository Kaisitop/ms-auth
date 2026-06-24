#!/bin/sh
set -e

echo "Esperando a que la base de datos PostgreSQL esté lista..."
while ! nc -z postgres 5432; do
  sleep 1
done
echo "PostgreSQL está listo."

echo "Ejecutando Prisma Generate..."
npx prisma generate

echo "Ejecutando migraciones de Prisma (db push)..."
npx prisma db push --accept-data-loss

echo "Iniciando la aplicación..."
exec "$@"
