

import 'dotenv/config'
import * as joi from 'joi'

interface EnvVars {
    NATS_SERVICE: string;
    DATABASE_URL: string;
    JWT_SERVICE: string;

}

const envsSchema = joi.object({
    NATS_SERVICE: joi.string().required(),
    DATABASE_URL: joi.string().required(),
    JWT_SERVICE: joi.string().required()
})
.unknown(true);

const {error , value } = envsSchema.validate(process.env)

if(error){
    throw new Error (`Error en la configuracion de la validacion ${error.message}`)
}

const envVars : EnvVars = value

export const envs = {
    natsService: envVars.NATS_SERVICE,
    dataBaseUrl: envVars.DATABASE_URL,
    jwtService: envVars.JWT_SERVICE
}
