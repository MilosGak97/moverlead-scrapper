import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HttpModule } from '@nestjs/axios';
import { CommonService } from './common-service';
import { ScrapperFailedService } from './scrapper-failed.service';
import { ScrapperService } from './scrapper.service';

@Module({
  imports: [HttpModule],
  controllers: [AppController],
  providers: [CommonService, ScrapperFailedService, ScrapperService],
})
export class AppModule {}
