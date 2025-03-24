import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppService } from './app.service';

async function bootstrap() {
  // Create an application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule);

  // Get the service that contains your background task logic
  const appService = app.get(AppService);

  try {
    // Run your taskstartedScrapperDynamo
    await appService.runScrapper()
    console.log('Task completed successfully.');
  } catch (error) {
    console.error('Task failed:', error);
  } finally {
    // Gracefully shut down the application context
    await app.close();
  }
}

bootstrap();
