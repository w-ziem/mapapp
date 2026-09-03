// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../../scripts/data/validate.mjs";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [100000, 100000],
      [101000, 100000],
      [101000, 101000],
      [100000, 100000],
    ],
  ],
};

describe("runtime snapshot validation", () => {
  it("accepts exactly 30 unique ranked metre-scale cities", () => {
    const cities = Array.from({ length: 30 }, (_, index) => ({
      type: "Feature",
      properties: {
        cityId: String(index + 1).padStart(7, "0"),
        name: `Miasto ${index + 1}`,
        rank: index + 1,
        population: 1000000 - index,
        areaM2: 500000,
        pivot: [100500, 100500],
      },
      geometry: polygon,
    }));
    expect(
      validateSnapshot({
        manifest: { crs: "EPSG:2180", cityCount: 30 },
        cities: { type: "FeatureCollection", features: cities },
        poland: { type: "FeatureCollection", features: [cities[0]] },
        voivodeships: {
          type: "FeatureCollection",
          features: cities.slice(0, 16),
        },
      }),
    ).toMatchObject({ valid: true, cityCount: 30 });
  });

  it("rejects duplicate city ids and non-finite geometry", () => {
    const invalid = Array.from({ length: 30 }, (_, index) => ({
      type: "Feature",
      properties: {
        cityId: "duplicate",
        name: `Miasto ${index}`,
        rank: index + 1,
        population: 1,
        areaM2: 1,
        pivot: [0, 0],
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [Number.NaN, 1], [0, 0]]],
      },
    }));
    expect(() =>
      validateSnapshot({
        manifest: { crs: "EPSG:2180", cityCount: 30 },
        cities: { type: "FeatureCollection", features: invalid },
        poland: { type: "FeatureCollection", features: [invalid[0]] },
        voivodeships: { type: "FeatureCollection", features: invalid.slice(0, 16) },
      }),
    ).toThrow();
  });
});
