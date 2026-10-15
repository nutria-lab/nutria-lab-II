import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_GATE_COOKIE = 'nutria_access';
export const ACCESS_GATE_REQUIRED_CODE = 'ACCESS_GATE_REQUIRED';
export const ACCESS_GATE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccessGateService {
  private readonly password = process.env.APP_ACCESS_PASSWORD;
  private readonly required = true;

  constructor() {
    if (!this.password && process.env.NODE_ENV === 'production') {
      throw new Error('APP_ACCESS_PASSWORD must be configured in production.');
    }
  }

  isRequired(): boolean {
    return this.required;
  }

  isValidPassword(password: string): boolean {
    return Boolean(this.password) && password === this.password;
  }

  createToken(now = Date.now()): string {
    const payload = `v1.${now}`;
    return `${payload}.${this.sign(payload)}`;
  }

  isValidToken(token: unknown, now = Date.now()): boolean {
    if (!this.required || typeof token !== 'string' || !this.password) {
      return false;
    }

    const [version, issuedAtValue, receivedSignature, ...extra] = token.split('.');
    const issuedAt = Number(issuedAtValue);

    if (
      version !== 'v1'
      || extra.length > 0
      || !Number.isSafeInteger(issuedAt)
      || issuedAt > now
      || now - issuedAt > ACCESS_GATE_TTL_MS
      || !receivedSignature
    ) {
      return false;
    }

    const expectedSignature = Buffer.from(this.sign(`v1.${issuedAt}`));
    const actualSignature = Buffer.from(receivedSignature);

    return expectedSignature.length === actualSignature.length
      && timingSafeEqual(expectedSignature, actualSignature);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.password ?? 'access-gate-disabled')
      .update(payload)
      .digest('base64url');
  }
}