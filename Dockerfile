# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Instalar dependencias necesarias para Prisma y Postgres
RUN apk add --no-cache openssl netcat-openbsd dos2unix

COPY package*.json ./
# npm ci es más rápido y determinista cuando existe package-lock.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

COPY . .

# Copiar el script de entrada y darle permisos (y asegurar fines de linea LF)
COPY docker-entrypoint.sh /usr/local/bin/
RUN dos2unix /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

# Generar el cliente de Prisma (cache de engines reutilizable entre builds)
RUN --mount=type=cache,target=/root/.cache/prisma npx prisma generate

EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start:dev"]
