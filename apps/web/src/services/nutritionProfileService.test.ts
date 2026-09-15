import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, describe, expect, it } from "vitest";
import {
  nutritionProfileService,
  NutritionProfileNotFoundError,
  type NutritionProfile,
} from "./nutritionProfileService";
import { apiClient } from "./apiClient";

const sampleProfile: NutritionProfile = {
  goal: "LOSE_WEIGHT",
  diet: "VEGAN",
  excludedIngredients: ["NUTS"],
  cookTimePreference: "STANDARD",
};

function successAdapter(data: unknown) {
  return async (
    config: InternalAxiosRequestConfig,
  ): Promise<AxiosResponse> => ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  });
}

function failingAdapter(status: number) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = {
      data: {},
      status,
      statusText: "Error",
      headers: {},
      config,
    };

    throw new AxiosError(
      `Request failed with status ${status}`,
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      response,
    );
  };
}

// nutritionProfileService no acepta config por llamada, así que el adapter
// se pisa en los defaults del apiClient real (mismo axios, mismo interceptor)
// en vez de mockear el módulo entero.
afterEach(() => {
  apiClient.defaults.adapter = undefined;
});

describe("nutritionProfileService", () => {
  it("getProfile returns the profile on success", async () => {
    apiClient.defaults.adapter = successAdapter(sampleProfile);

    const result = await nutritionProfileService.getProfile();

    expect(result).toEqual(sampleProfile);
  });

  it("getProfile throws NutritionProfileNotFoundError on 404", async () => {
    apiClient.defaults.adapter = failingAdapter(404);

    await expect(nutritionProfileService.getProfile()).rejects.toBeInstanceOf(
      NutritionProfileNotFoundError,
    );
  });

  it("getProfile rethrows other errors as-is", async () => {
    apiClient.defaults.adapter = failingAdapter(500);

    await expect(nutritionProfileService.getProfile()).rejects.toThrow(
      "Request failed with status 500",
    );
  });

  it("updateProfile sends the full profile and returns what the server persisted", async () => {
    let capturedConfig: InternalAxiosRequestConfig | undefined;
    apiClient.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: sampleProfile,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    const result = await nutritionProfileService.updateProfile(sampleProfile);

    expect(result).toEqual(sampleProfile);
    expect(capturedConfig?.url).toBe("/nutrition-profile");
    expect(JSON.parse(capturedConfig?.data as string)).toEqual(sampleProfile);
  });
});
