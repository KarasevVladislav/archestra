import { describe, expect, it } from "vitest";
import { isFormShapeCron } from "./utils";

describe("isFormShapeCron", () => {
  describe("valid form-shape expressions", () => {
    const VALID_CASES = [
      "0 * * * *",
      "59 * * * *",
      "30 * * * *",
      "0 9 * * *",
      "0 0 * * *",
      "0 23 * * *",
      "0 9 * * 0",
      "0 9 * * 6",
      "30 23 * * 0,6",
      "0 9 * * 1,2,3,4,5",
      "0 9 * * 0,1,2,3,4,5,6",
    ];

    for (const cron of VALID_CASES) {
      it(`accepts "${cron}"`, () => {
        expect(isFormShapeCron(cron)).toBe(true);
      });
    }

    it("trims surrounding whitespace and collapses spaces", () => {
      expect(isFormShapeCron("  0   9   *   *   1  ")).toBe(true);
    });
  });

  describe("invalid expressions", () => {
    const INVALID_CASES = [
      ["empty", ""],
      ["only spaces", "   "],
      ["6 fields", "0 0 9 * * 1"],
      ["4 fields", "0 9 * *"],
      ["day-of-month list", "0 9 1,15 * *"],
      ["specific month", "0 9 * 1 *"],
      ["weekday range", "0 9 * * 1-5"],
      ["minute step", "*/15 * * * *"],
      ["hour step", "0 */2 * * *"],
      ["minute out of range", "60 9 * * *"],
      ["hour out of range", "0 24 * * *"],
      ["weekday out of range", "0 9 * * 7"],
      ["duplicate weekday", "0 9 * * 1,1"],
      ["leading zero minute", "00 * * * *"],
      ["leading zero hour", "0 09 * * *"],
      ["question mark", "0 9 ? * *"],
      ["L modifier", "0 9 * * L"],
      ["text minute", "abc * * * *"],
      ["empty weekday entry", "0 9 * * 1,"],
    ];

    for (const [label, cron] of INVALID_CASES) {
      it(`rejects ${label} (${JSON.stringify(cron)})`, () => {
        expect(isFormShapeCron(cron)).toBe(false);
      });
    }
  });
});
