import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '@/modules/auth/guards/jwt-auth.guard';
import { AuthService } from '@/modules/auth/auth.service';
import { AuthResponseDto } from '@/modules/auth/dto/auth-response.dto';
import { RegisterRequestDto } from '@/modules/auth/dto/register-request.dto';
import { LoginRequestDto } from '@/modules/auth/dto/login-request.dto';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterRequestDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginRequestDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponseDto> {
    const { user, token } = await this.authService.login(loginDto);
    
    // Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 1 dia
    });

    return user;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<AuthResponseDto> {
    const user = await this.authService.findById(request.user!.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Res({passthrough: true}) res: Response): Promise<void> {
    res.clearCookie('token',{
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }
 
}
