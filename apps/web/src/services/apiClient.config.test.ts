import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("apiClient env configuration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the same-site relative API base for protected requests in non-development builds", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_URL", "https://nutria-lab-ii-api.vercel.app");

    const { apiClient } = await import("./apiClient");

    expect(apiClient.defaults.baseURL).toBe("/api");
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it("uses the explicitly configured local backend URL during development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_API_URL", "http://localhost:3000");

    const { apiClient } = await import("./apiClient");

    expect(apiClient.defaults.baseURL).toBe("http://localhost:3000");
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});
