-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateTable
CREATE TABLE "identity"."roles" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."permisos" (
    "id" UUID NOT NULL,
    "modulo" VARCHAR(100) NOT NULL,
    "accion" VARCHAR(100) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."roles_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,

    CONSTRAINT "roles_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "identity"."usuarios" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "email_verificado" BOOLEAN NOT NULL DEFAULT false,
    "hash_password" CHAR(60) NOT NULL,
    "totp_secret" VARCHAR(128),
    "totp_habilitado" BOOLEAN NOT NULL DEFAULT false,
    "nombre" VARCHAR(100) NOT NULL,
    "telefono" VARCHAR(20),
    "rol_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMPTZ(6),
    "ultimo_login" TIMESTAMPTZ(6),
    "token_reset_pwd" CHAR(64),
    "token_reset_exp" TIMESTAMPTZ(6),
    "token_verif_email" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "refresh_token" CHAR(64) NOT NULL,
    "user_agent" TEXT NOT NULL,
    "ip_address" INET NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocada_en" TIMESTAMPTZ(6),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."audit_log" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "accion" VARCHAR(100) NOT NULL,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "identity"."roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_modulo_accion_key" ON "identity"."permisos"("modulo", "accion");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "identity"."usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_rol_id_idx" ON "identity"."usuarios"("rol_id");

-- CreateIndex
CREATE INDEX "usuarios_email_idx" ON "identity"."usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_deleted_at_idx" ON "identity"."usuarios"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_refresh_token_key" ON "identity"."sesiones"("refresh_token");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "identity"."sesiones"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_refresh_token_idx" ON "identity"."sesiones"("refresh_token");

-- CreateIndex
CREATE INDEX "sesiones_expira_en_idx" ON "identity"."sesiones"("expira_en");

-- CreateIndex
CREATE INDEX "audit_log_usuario_id_idx" ON "identity"."audit_log"("usuario_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "identity"."audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_accion_idx" ON "identity"."audit_log"("accion");

-- AddForeignKey
ALTER TABLE "identity"."roles_permisos" ADD CONSTRAINT "roles_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."roles_permisos" ADD CONSTRAINT "roles_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "identity"."permisos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "identity"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "identity"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."audit_log" ADD CONSTRAINT "audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "identity"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
