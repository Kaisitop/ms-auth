# ms-auth - Guia tecnica y endpoints de autenticacion

> **Monorepo:** [README.md](../README.md) · [docs/contexto.md](../docs/contexto.md)

`ms-auth` maneja usuarios, login, JWT, refresh tokens, sesiones y recuperacion de contrasena. No expone HTTP; recibe mensajes NATS desde `c-gateway`.

**Capacidades recientes:** emails transaccionales vía eventos NATS (`email.send_*`), reset password con canal `web`|`app`, alta de usuarios por admin, purge de usuarios demo (`maintenance.purgeUsers`).

## Configuracion

```env
NATS_SERVICE=nats://localhost:4222
DATABASE_URL="postgresql://postgres:TU_PASSWORD@localhost:5432/authDB?schema=public"
JWT_SERVICE=soyUnSecret
```

Preparar base:

```bash
npx.cmd prisma migrate deploy
npx.cmd prisma db seed
npm run start:dev
```

Usuarios de prueba del seed:

| Rol | Email | Password |
|---|---|---|
| Admin | `admin@centinela.com` | `Admin123!` |
| Operador | `operador@centinela.com` | `Operador123!` |
| Policia | `policia@centinela.com` | `Policia123!` |

## Acceso HTTP por gateway

```text
Base URL: http://localhost:3000/api/auth
```

### Registrar usuario

```http
POST /api/auth/register
Content-Type: application/json
```

```json
{
  "email": "usuario@centinela.com",
  "password": "Seguro123!",
  "nombre": "Usuario Prueba",
  "telefono": "0999999999"
}
```

Campos:

```text
email: email valido, obligatorio
password: password fuerte, obligatorio
nombre: string, obligatorio
telefono: string, opcional
```

> **Nota arquitectónica (Zonas):** El registro en `ms-auth` se encarga exclusivamente de la identidad (LOPDP). Para completar el flujo en la app ciudadana, el frontend debe iniciar sesión tras el registro y luego llamar a `POST /api/zonas/usuarios/:usuarioId/principal` en el Gateway para establecer la zona base del usuario.

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "email": "admin@centinela.com",
  "password": "Admin123!"
}
```

Respuesta principal:

```json
{
  "accessToken": "{{accessToken}}",
  "refreshToken": "{{refreshToken}}",
  "user": {
    "id": "{{userId}}",
    "email": "admin@centinela.com"
  }
}
```

### Refresh token

```http
POST /api/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

### Logout

```http
POST /api/auth/logout
Content-Type: application/json
```

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

### Verificar email

```http
POST /api/auth/verify-email
Content-Type: application/json
```

```json
{
  "token": "{{tokenVerificacion}}"
}
```

### Solicitar recuperacion de contrasena

```http
POST /api/auth/forgot-password
Content-Type: application/json
```

```json
{
  "email": "usuario@centinela.com"
}
```

### Resetear contrasena

```http
POST /api/auth/reset-password
Content-Type: application/json
```

```json
{
  "token": "{{tokenReset}}",
  "newPassword": "NuevoSeguro123!"
}
```

### Desactivar usuario

Requiere token con permiso `usuarios:eliminar`.

```http
DELETE /api/auth/user/{{userId}}
Authorization: Bearer {{accessToken}}
```

## Patrones NATS internos

| Pattern | Payload | Descripcion |
|---|---|---|
| `register.user.auth` | `RegisterUserDto` | Registra usuario |
| `login.user.auth` | `LoginUserDto + ipAddress + userAgent` | Inicia sesion |
| `refresh.token.auth` | `{ refreshToken, ipAddress?, userAgent? }` | Renueva token |
| `logout.user.auth` | `{ refreshToken }` | Cierra sesion |
| `verify.email.auth` | `{ token }` | Verifica email |
| `forgot.password.auth` | `{ email, channel?: 'web' \| 'app' }` | Genera solicitud de recuperacion |
| `reset.password.auth` | `{ token, newPassword }` | Cambia contrasena |
| `maintenance.purgeUsers` | `{ requestedBy }` | Purga usuarios no seed (admin) |
| `email.send_verification` | *(evento emitido)* | → ms-notificaciones |
| `email.send_password_reset` | *(evento emitido)* | → ms-notificaciones |
| `deactivate.user.auth` | `{ userId, requestedBy }` | Desactiva usuario |
| `audit.log.create` | `CreateAuditLogDto` | Registra auditoria |

## Ejemplos NATS

Registro:

```json
{
  "email": "operador2@centinela.com",
  "password": "Seguro123!",
  "nombre": "Operador Dos",
  "telefono": "0999999999",
  "zonaId": "{{zonaId}}"
}
```

Login:

```json
{
  "email": "admin@centinela.com",
  "password": "Admin123!",
  "ipAddress": "127.0.0.1",
  "userAgent": "PostmanRuntime"
}
```

Desactivar usuario:

```json
{
  "userId": "{{userId}}",
  "requestedBy": "{{adminId}}"
}
```

## Seguridad

Las rutas publicas son:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/verify-email
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

La desactivacion de usuarios requiere JWT y permiso.

## Permisos relacionados con fotos y reportes

Los permisos se asignan por rol en el seed (`prisma/seed.ts`). Los más relevantes para el flujo de imágenes:

| Permiso | Rol típico | Uso |
|---|---|---|
| `reportes:create` | ciudadano | Subir fotos (`tipo=reporte`) y crear reportes |
| `reportes:read_all` | admin, operador | Ver listado y detalle con `fotosUrls` |
| `reportes:read_own` | ciudadano | Ver solo sus reportes |
| `reportes:update` | operador | Tomar / resolver reportes |
| `alertas:read` / `alertas:read_all` | admin, operador | Ver alertas y evidencia en el panel |
| `alertas:update_status` | operador, patrullero | Subir evidencia (`tipo=evidencia`) y cerrar alertas |

El gateway valida JWT + permisos antes de proxy a NATS o subida a Cloudinary.
