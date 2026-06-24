FROM node:18-alpine

WORKDIR /app

# Instalar dependencias necesarias para Prisma y Postgres
RUN apk add --no-cache openssl netcat-openbsd

COPY package*.json ./
RUN npm install

COPY . .

# Copiar el script de entrada y darle permisos
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Generar el cliente de Prisma
RUN npx prisma generate

EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start:dev"]
