import { Module } from '@nestjs/common';
import { UserRepository } from '../user/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';



@Module({
  imports: [
    JwtModule.register({
      global: true, // Hace que JwtService esté disponible en toda la app
      secret: process.env.JWT_SECRET || 'super-secret-key',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard, AuthService, UserRepository],
  exports: [JwtAuthGuard, JwtModule, AuthService, UserRepository],
})
export class AuthModule {}
