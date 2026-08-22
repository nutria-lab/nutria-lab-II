import { Module } from '@nestjs/common';
import { UserRepository } from '../user/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, UserRepository],
  exports: [AuthService, UserRepository],
})
export class AuthModule {}
