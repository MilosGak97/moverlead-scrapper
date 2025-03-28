import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ScrapperService } from './scrapper.service';
import { ScrapperFailedService } from './scrapper-failed.service';

async function bootstrap() {
  // Create an application context (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(AppModule);

  // Get the service that contains your background task logic
  const scrapper = app.get(ScrapperService);
  const scrapperFailed = app.get(ScrapperFailedService)

  try {
    await scrapper.runScrapper()
    console.log('Task completed successfully.');
  } catch (error) {
    console.error('Task failed:', error);
  } finally {
    // Gracefully shut down the application context
    await app.close();
  }
}

bootstrap();
