import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UnsplashService } from './unsplash.service';

@Module({
  imports: [ConfigModule],
  providers: [UnsplashService],
  exports: [UnsplashService],
})
export class UnsplashModule {}
