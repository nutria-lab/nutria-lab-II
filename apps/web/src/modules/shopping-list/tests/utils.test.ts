import { describe, expect, it } from "vitest";

import {
  formatWeekRange,
  getBuenosAiresWeekStart,
  isMondayDate,
  shiftWeekStart,
} from "@/modules/shopping-list/utils";

describe("shopping list calendar helpers", () => {
  it("accepts only real Monday calendar dates", () => {
    expect(isMondayDate("2026-10-19")).toBe(true);
    expect(isMondayDate("2026-02-30")).toBe(false);
    expect(isMondayDate("2026-10-20")).toBe(false);
  });

  it("shifts across month and year boundaries using calendar dates", () => {
    expect(shiftWeekStart("2026-12-28", 1)).toBe("2027-01-04");
    expect(shiftWeekStart("2027-01-04", -1)).toBe("2026-12-28");
  });

  it("formats Monday through Sunday in UTC calendar time", () => {
    expect(formatWeekRange("2026-10-26")).toBe(
      "26 de octubre de 2026 – 1 de noviembre de 2026",
    );
  });

  it("finds the Buenos Aires Monday from a fixed instant without browser local time", () => {
    expect(getBuenosAiresWeekStart(new Date("2026-10-25T02:00:00.000Z"))).toBe(
      "2026-10-19",
    );
    expect(getBuenosAiresWeekStart(new Date("2026-10-26T04:00:00.000Z"))).toBe(
      "2026-10-26",
    );
  });
});
