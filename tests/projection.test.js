import { get as getProjection } from "ol/proj.js";
import { describe, expect, it } from "vitest";
import { registerPolandProjection } from "../src/projection.js";

describe("registerPolandProjection", () => {
  it("registers EPSG:2180 with metre units and the Poland extent", () => {
    const projection = registerPolandProjection();
    expect(getProjection("EPSG:2180")).toBe(projection);
    expect(projection.getUnits()).toBe("m");
    expect(projection.getExtent()).toEqual([100000, 100000, 900000, 850000]);
  });
});
