import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./apiClient";
import { registerService } from "./registerService";

vi.mock("./apiClient", () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const registeredUser = {
  id: "user-9",
  email: "persona@nutria.com",
  name: "Persona NutrIA",
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

const requestConfig = {
  headers: {},
} as InternalAxiosRequestConfig;

function httpFailure(status: number) {
  return new AxiosError(
    `Request failed with status ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    requestConfig,
    undefined,
    {
      data: { message: "internal backend detail" },
      status,
      statusText: "Error",
      headers: {},
      config: requestConfig,
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("registerService.register", () => {
  it("uses the shared client to post the exact DTO payload and returns AuthResponseDto", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: registeredUser });

    await expect(
      registerService.register({
        name: "  Persona NutrIA  ",
        email: "  persona@nutria.com  ",
        password: "clave-de-prueba",
      }),
    ).resolves.toEqual(registeredUser);

    expect(apiClient.post).toHaveBeenCalledWith(
      "/auth/register",
      {
        name: "Persona NutrIA",
        email: "persona@nutria.com",
        password: "clave-de-prueba",
      },
      expect.objectContaining({
        skipAuthErrorHandling: true,
        timeout: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).not.toHaveProperty(
      "confirmPassword",
    );
  });

  it.each([
    [409, "emailAlreadyExists"],
    [400, "validation"],
  ] as const)(
    "normalizes HTTP %i as %s without exposing the backend body",
    async (status, kind) => {
      vi.mocked(apiClient.post).mockRejectedValue(httpFailure(status));

      await expect(
        registerService.register({
          email: "persona@nutria.com",
          password: "clave-de-prueba",
          name: "Persona",
        }),
      ).rejects.toMatchObject({ kind });
    },
  );

  it("normalizes an Axios failure without a response as a network error", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError("Network Error", AxiosError.ERR_NETWORK, requestConfig),
    );

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("normalizes an Axios cancellation as a network failure", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError("canceled", AxiosError.ERR_CANCELED, requestConfig),
    );

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("normalizes Axios ECONNABORTED as a timeout distinct from network failures and cancellations", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError("timeout", "ECONNABORTED", requestConfig),
    );

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("does not conflate an Axios timeout with a network failure", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new AxiosError("timeout", "ECONNABORTED", requestConfig),
    );

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.not.toMatchObject({ kind: "network" });
  });

  it("normalizes malformed success responses and non-Axios failures as unexpected", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { id: registeredUser.id },
    });

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.toMatchObject({ kind: "unexpected" });

    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error("unexpected"));

    await expect(
      registerService.register({
        email: "persona@nutria.com",
        password: "clave-de-prueba",
        name: "Persona",
      }),
    ).rejects.toMatchObject({ kind: "unexpected" });
  });
});
