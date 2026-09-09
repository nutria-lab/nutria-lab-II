import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { NutritionProfileModule } from './modules/nutrition-profile/nutrition-profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    NutritionProfileModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
