import { describe, expect, it } from "vitest";
import {
  getDisplayPivot,
  inverseTransformPoint,
  planarArea,
  transformGeometry,
  transformPoint,
} from "../../src/domain/geometry.js";

const polygon = {
  type: "Polygon",
  coordinates: [[[10, 20], [12, 20], [12, 22], [10, 22], [10, 20]]],
};
const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [polygon.coordinates, [[[14, 20], [15, 20], [14, 21], [14, 20]]]],
};

describe("immutable EPSG:2180 transformations", () => {
  it("rotates 90 degrees and translates around a fixed pivot", () => {
    expect(transformPoint([11, 20], [10, 20], [100, -50], Math.PI / 2)).toEqual([
      110,
      -29,
    ]);
  });

  it.each([polygon, multiPolygon])(
    "preserves area and supports an inverse for %s",
    (source) => {
      const overlay = {
        pivot: [10, 20],
        translation: [500, -200],
        angle: 1.2,
      };
      const transformed = transformGeometry(source, overlay);
      expect(
        Math.abs(planarArea(source) - planarArea(transformed)) / planarArea(source),
      ).toBeLessThan(1e-9);
      const point =
        transformed.type === "Polygon"
          ? transformed.coordinates[0][0]
          : transformed.coordinates[0][0][0];
      const restored = inverseTransformPoint(point, overlay);
      expect(restored[0]).toBeCloseTo(10, 8);
      expect(restored[1]).toBeCloseTo(20, 8);
    },
  );

  it("never mutates source geometry or the immutable pivot", () => {
    const source = structuredClone(multiPolygon);
    const overlay = { pivot: [10, 20], translation: [1, 2], angle: 0.3 };
    const before = structuredClone({ source, overlay });
    transformGeometry(source, overlay);
    expect({ source, overlay }).toEqual(before);
    expect(getDisplayPivot(overlay)).toEqual([11, 22]);
  });
});
