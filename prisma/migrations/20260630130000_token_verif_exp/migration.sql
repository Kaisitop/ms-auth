-- Expiración para el token de verificación de email
ALTER TABLE "identity"."usuarios" ADD COLUMN "token_verif_exp" TIMESTAMPTZ(6);
