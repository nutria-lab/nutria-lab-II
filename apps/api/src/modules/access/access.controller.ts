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
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VerifyAccessDto } from './dto/verify-access.dto';
import {
  ACCESS_GATE_COOKIE,
  ACCESS_GATE_TTL_MS,
  AccessGateService,
} from './access-gate.service';

@Controller('access')
export class AccessController {
  constructor(private readonly accessGateService: AccessGateService) {}

  @Get('status')
  status(@Req() request: Request) {
    const unlocked = this.accessGateService.isValidToken(
      request.cookies?.[ACCESS_GATE_COOKIE],
    );

    return {
      required: this.accessGateService.isRequired(),
      unlocked,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  verify(
    @Body() body: VerifyAccessDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.accessGateService.isValidPassword(body.password)) {
      throw new UnauthorizedException('Invalid access password.');
    }

    response.cookie(ACCESS_GATE_COOKIE, this.accessGateService.createToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: ACCESS_GATE_TTL_MS,
    });

    return { unlocked: true };
  }
}