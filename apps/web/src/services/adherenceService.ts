import { apiClient } from './apiClient';
import type {
  AdherenceResponse,
  UpdateMealCompletionRequest,
  UpdateMealCompletionResponse,
} from '../modules/adherence/types';

const ADHERENCE_REQUEST_TIMEOUT_MS = 10_000;

export const adherenceService = {
  async getForWeek(weekStart: string, signal?: AbortSignal): Promise<AdherenceResponse> {
    const response = await apiClient.get<AdherenceResponse>('/adherence', {
      params: { weekStart },
      timeout: ADHERENCE_REQUEST_TIMEOUT_MS,
      signal,
    });
    return response.data;
  },

  async setMealStatus(
    plannedMealId: string,
    body: UpdateMealCompletionRequest,
    signal?: AbortSignal,
  ): Promise<UpdateMealCompletionResponse> {
    const response = await apiClient.put<UpdateMealCompletionResponse>(
      `/adherence/meals/${encodeURIComponent(plannedMealId)}`,
      body,
      { signal, timeout: ADHERENCE_REQUEST_TIMEOUT_MS },
    );
    return response.data;
  },
};
