import { Module } from '@nestjs/common';
import { UserRepository } from '../user/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('FATAL ERROR: JWT_SECRET is not defined in environment variables');
}

@Module({
  imports: [
    JwtModule.register({
      global: true, // Hace que JwtService esté disponible en toda la app
      secret: jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard, AuthService, UserRepository],
  exports: [JwtAuthGuard, JwtModule, AuthService, UserRepository],
})
export class AuthModule {}
