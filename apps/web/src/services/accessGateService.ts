import axios from 'axios';

import { apiClient } from './apiClient';

const ACCESS_GATE_REQUEST_TIMEOUT_MS = 10_000;

export type AccessGateStatus = {
  required: boolean;
  unlocked: boolean;
};

export type AccessGateErrorKind = 'invalidPassword' | 'network';

export class AccessGateRequestError extends Error {
  constructor(public readonly kind: AccessGateErrorKind) {
    super(kind);
    this.name = 'AccessGateRequestError';
  }
}

function isAccessGateStatus(value: unknown): value is AccessGateStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  return typeof status.required === 'boolean' && typeof status.unlocked === 'boolean';
}

export const accessGateService = {
  async getStatus(signal?: AbortSignal): Promise<AccessGateStatus> {
    try {
      const { data } = await apiClient.get('/access/status', {
        signal,
        timeout: ACCESS_GATE_REQUEST_TIMEOUT_MS,
        skipAuthErrorHandling: true,
      });
      if (!isAccessGateStatus(data)) throw new AccessGateRequestError('network');
      return data;
    } catch (error) {
      if (error instanceof AccessGateRequestError) throw error;
      throw new AccessGateRequestError('network');
    }
  },

  async verify(password: string, signal?: AbortSignal): Promise<void> {
    try {
      const { data } = await apiClient.post('/access/verify', { password }, {
        signal,
        timeout: ACCESS_GATE_REQUEST_TIMEOUT_MS,
        skipAuthErrorHandling: true,
      });
      if (!data || data.unlocked !== true) throw new AccessGateRequestError('network');
    } catch (error) {
      if (error instanceof AccessGateRequestError) throw error;
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new AccessGateRequestError('invalidPassword');
      }
      throw new AccessGateRequestError('network');
    }
  },
};