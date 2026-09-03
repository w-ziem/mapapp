import { describe, expect, it } from "vitest";
import {
  getRotationDelta,
  normalizeSearch,
} from "../../src/ui/controls.js";

describe("search and keyboard controls", () => {
  it("normalizes Polish accents, case, and whitespace", () => {
    expect(normalizeSearch("  ŁÓDŹ  ")).toBe("lodz");
    expect(normalizeSearch("Bielsko–Biała")).toBe("bielsko biala");
  });

  it("maps brackets to one or fifteen degree steps", () => {
    expect(getRotationDelta({ key: "]", shiftKey: false })).toBe(1);
    expect(getRotationDelta({ key: "[", shiftKey: true })).toBe(-15);
    expect(getRotationDelta({ key: "x", shiftKey: false })).toBe(0);
  });
});
