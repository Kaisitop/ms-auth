import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { envs } from './config/envs';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  
  const logger = new Logger('Microservicio Auth')
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule,{
    transport: Transport.NATS,
    options: {
      servers: envs.natsService
    }
  });
  app.useGlobalPipes(
    new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    })
  );

  logger.log('Microservicio Auth corriendo')
  await app.listen();
}
bootstrap();
