// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateGeometryTopology } from "../../scripts/data/geometry.mjs";
import * as snapshotValidator from "../../scripts/data/validate.mjs";

const { validateSnapshot } = snapshotValidator;

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

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

function validManifest() {
  return {
    crs: "EPSG:2180",
    cityCount: 30,
    files: {
      cities: "cities.geojson",
      poland: "poland.geojson",
      voivodeships: "voivodeships.geojson",
      validation: "validation-report.json",
    },
    outputs: Object.fromEntries(
      ["cities", "poland", "voivodeships", "validation"].map((name) => [
        name,
        { sha256: "0".repeat(64) },
      ]),
    ),
    sources: [{
      institution: "Official institution",
      dataset: "Official dataset",
      landingPage: "https://example.test/dataset",
      retrievedAt: "2026-09-03T20:00:00.000Z",
      validAt: "2025-12-31",
      license: "https://example.test/license",
      attribution: "Source: Official institution; processed.",
      artifacts: [{
        effectiveUrl: "https://example.test/source.bin",
        fileName: "source.bin",
        sha256: "1".repeat(64),
      }],
    }],
  };
}

function orientation(a, b, c) {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function properIntersection(a, b, c, d) {
  return orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0;
}

function ringSelfIntersects(ring) {
  for (let first = 0; first < ring.length - 1; first += 1) {
    for (let second = first + 2; second < ring.length - 1; second += 1) {
      if (first === 0 && second === ring.length - 2) continue;
      if (properIntersection(ring[first], ring[first + 1], ring[second], ring[second + 1])) {
        return true;
      }
    }
  }
  return false;
}

function geometryRings(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat();
}

describe("runtime snapshot validation", () => {
  it("publishes city rings without proper self-intersections", async () => {
    const cities = JSON.parse(await readFile("public/data/cities.geojson", "utf8"));
    const invalidCities = cities.features
      .filter(({ geometry }) => geometryRings(geometry).some(ringSelfIntersects))
      .map(({ properties }) => properties.name);

    expect(invalidCities).toEqual([]);
  });

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
        manifest: validManifest(),
        cities: { type: "FeatureCollection", features: cities },
        poland: { type: "FeatureCollection", features: [cities[0]] },
        voivodeships: {
          type: "FeatureCollection",
          features: cities.slice(0, 16),
        },
      }),
    ).toMatchObject({ valid: true, cityCount: 30 });
  });

  it("rejects a ring with a proper self-intersection even when its area is positive", () => {
    const selfIntersecting = {
      type: "Polygon",
      coordinates: [[
        [100000, 100000],
        [104000, 100000],
        [104000, 104000],
        [102000, 99000],
        [100000, 104000],
        [100000, 100000],
      ]],
    };
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
      geometry: index === 0 ? selfIntersecting : polygon,
    }));

    expect(() =>
      validateSnapshot({
        manifest: validManifest(),
        cities: { type: "FeatureCollection", features: cities },
        poland: { type: "FeatureCollection", features: [cities[1]] },
        voivodeships: {
          type: "FeatureCollection",
          features: cities.slice(1, 17),
        },
      }),
    ).toThrow(/self-intersection/i);
  });

  it("rejects unclosed rings and rings with fewer than three distinct points", () => {
    expect(() =>
      validateGeometryTopology({
        type: "Polygon",
        coordinates: [[[0, 0], [2, 0], [0, 2], [1, 1]]],
      }),
    ).toThrow(/not closed/i);
    expect(() =>
      validateGeometryTopology({
        type: "Polygon",
        coordinates: [[[0, 0], [2, 0], [2, 0], [0, 0]]],
      }),
    ).toThrow(/three distinct points/i);
  });

  it("rejects missing runtime provenance fields", () => {
    const manifest = validManifest();
    delete manifest.sources[0].institution;

    expect(() =>
      validateSnapshot({
        manifest,
        cities: {
          type: "FeatureCollection",
          features: Array.from({ length: 30 }, (_, index) => ({
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
          })),
        },
        poland: { type: "FeatureCollection", features: [{
          type: "Feature",
          properties: {},
          geometry: polygon,
        }] },
        voivodeships: {
          type: "FeatureCollection",
          features: Array.from({ length: 16 }, () => ({
            type: "Feature",
            properties: {},
            geometry: polygon,
          })),
        },
      }),
    ).toThrow(/institution/i);
  });

  it("rejects a tampered runtime output", () => {
    const outputContents = {
      cities: "tampered",
      poland: "poland",
      voivodeships: "voivodeships",
      validation: "validation",
    };
    const manifest = validManifest();
    for (const [name, content] of Object.entries(outputContents)) {
      manifest.outputs[name].sha256 = sha256(
        name === "cities" ? "official cities" : content,
      );
    }

    expect(snapshotValidator.validateOutputHashes).toBeTypeOf("function");
    expect(() =>
      snapshotValidator.validateOutputHashes(manifest, outputContents),
    ).toThrow(/SHA-256 mismatch.*cities/i);
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
        manifest: validManifest(),
        cities: { type: "FeatureCollection", features: invalid },
        poland: { type: "FeatureCollection", features: [invalid[0]] },
        voivodeships: { type: "FeatureCollection", features: invalid.slice(0, 16) },
      }),
    ).toThrow();
  });
});
