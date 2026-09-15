import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNutritionProfile } from "./useNutritionProfile";
import {
  nutritionProfileService,
  NutritionProfileNotFoundError,
  type NutritionProfile,
} from "../../../services/nutritionProfileService";

vi.mock("../../../services/nutritionProfileService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../services/nutritionProfileService")
    >();
  return {
    ...actual,
    nutritionProfileService: { getProfile: vi.fn(), updateProfile: vi.fn() },
  };
});

const sampleProfile: NutritionProfile = {
  goal: "LOSE_WEIGHT",
  diet: "VEGAN",
  excludedIngredients: ["NUTS"],
  cookTimePreference: "STANDARD",
};

describe("useNutritionProfile", () => {
  beforeEach(() => {
    vi.mocked(nutritionProfileService.getProfile).mockReset();
    vi.mocked(nutritionProfileService.updateProfile).mockReset();
  });

  it("loads an existing profile", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockResolvedValue(
      sampleProfile,
    );

    const { result } = renderHook(() => useNutritionProfile());

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.profile).toEqual(sampleProfile);
    expect(result.current.isNewProfile).toBe(false);
  });

  it("treats a missing profile (404) as a fresh start, not a technical error", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockRejectedValue(
      new NutritionProfileNotFoundError(),
    );

    const { result } = renderHook(() => useNutritionProfile());

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.isNewProfile).toBe(true);
    expect(result.current.profile).not.toBeNull();
  });

  it("sets an error state for a technical load failure", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockRejectedValue(
      new Error("network error"),
    );

    const { result } = renderHook(() => useNutritionProfile());

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("recovers via retry() after a failed initial load", async () => {
    vi.mocked(nutritionProfileService.getProfile)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(sampleProfile);

    const { result } = renderHook(() => useNutritionProfile());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.profile).toBeNull();

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.profile).toEqual(sampleProfile);
  });

  it("rejects saving with duplicate excluded ingredients before calling the API", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockResolvedValue(
      sampleProfile,
    );
    const { result } = renderHook(() => useNutritionProfile());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      await result.current.save({
        ...sampleProfile,
        excludedIngredients: ["NUTS", "NUTS"],
      });
    });

    expect(result.current.status).toBe("error");
    expect(nutritionProfileService.updateProfile).not.toHaveBeenCalled();
  });

  it("saves successfully and updates the profile from the server response", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockResolvedValue(
      sampleProfile,
    );
    const updated: NutritionProfile = { ...sampleProfile, goal: "MAINTAIN" };
    vi.mocked(nutritionProfileService.updateProfile).mockResolvedValue(updated);

    const { result } = renderHook(() => useNutritionProfile());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      await result.current.save(updated);
    });

    expect(result.current.status).toBe("success");
    expect(result.current.profile).toEqual(updated);
  });

  it("keeps the caller-provided state available after a failed save", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockResolvedValue(
      sampleProfile,
    );
    vi.mocked(nutritionProfileService.updateProfile).mockRejectedValueOnce(
      new Error("network error"),
    );

    const { result } = renderHook(() => useNutritionProfile());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      await result.current.save(sampleProfile);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.profile).toEqual(sampleProfile);
  });

  it("recovers after a retry succeeds following a failed save", async () => {
    vi.mocked(nutritionProfileService.getProfile).mockResolvedValue(
      sampleProfile,
    );
    vi.mocked(nutritionProfileService.updateProfile)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(sampleProfile);

    const { result } = renderHook(() => useNutritionProfile());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      await result.current.save(sampleProfile);
    });
    expect(result.current.status).toBe("error");

    await act(async () => {
      await result.current.save(sampleProfile);
    });
    expect(result.current.status).toBe("success");
  });
});
