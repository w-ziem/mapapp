// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeSrsName,
  parseGmlFeatureCollection,
  parsePosList,
} from "../../scripts/data/gml.mjs";
import {
  geometryArea,
  geometryPivot,
  projectGeometry,
  selectRankedCities,
} from "../../scripts/data/geometry.mjs";

const schema = {
  featureType: "A04_Granice_miast",
  geometryProperty: "msGeometry",
  idProperty: "JPT_KOD_JE",
  nameProperty: "JPT_NAZWA_",
  sourceCrs: "EPSG:4326",
  axisOrder: "yx",
};

describe("official PRG GML adapter", () => {
  it("normalizes CRS and formal latitude-longitude axis order", () => {
    expect(normalizeSrsName("urn:ogc:def:crs:EPSG::4326")).toBe("EPSG:4326");
    expect(parsePosList("52.2297 21.0122 52.23 21.02", "yx")).toEqual([
      [21.0122, 52.2297],
      [21.02, 52.23],
    ]);
  });

  it("parses Polygon properties and projects to metre coordinates", async () => {
    const [feature] = parseGmlFeatureCollection(
      await readFile("data/fixtures/prg-city-polygon.gml", "utf8"),
      schema,
    );
    expect(feature.properties).toMatchObject({
      JPT_KOD_JE: "146501",
      JPT_NAZWA_: "Warszawa testowa",
    });
    const projected = projectGeometry(feature.geometry, "EPSG:4326", "EPSG:2180");
    expect(projected.type).toBe("Polygon");
    expect(projected.coordinates.flat(2).every(Number.isFinite)).toBe(true);
    expect(geometryArea(projected)).toBeGreaterThan(0);
    expect(geometryPivot(projected).every(Number.isFinite)).toBe(true);
  });

  it("parses MultiSurface as GeoJSON MultiPolygon", async () => {
    const [feature] = parseGmlFeatureCollection(
      await readFile("data/fixtures/prg-city-multipolygon.gml", "utf8"),
      schema,
    );
    expect(feature.geometry.type).toBe("MultiPolygon");
    expect(feature.geometry.coordinates).toHaveLength(2);
  });

  it("joins ranked cities only by normalized TERYT", () => {
    const features = [
      {
        properties: { JPT_KOD_JE: "146501_1", JPT_NAZWA_: "Inna nazwa" },
        geometry: { type: "Polygon", coordinates: [] },
      },
    ];
    const [joined] = selectRankedCities(features, [
      { cityId: "1465011", name: "Warszawa", rank: 1, population: 1 },
    ]);
    expect(joined.properties).toMatchObject({
      cityId: "1465011",
      name: "Warszawa",
      rank: 1,
    });
  });

  it("aggregates PRG district units by the parent TERYT for special cities", () => {
    const geometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]],
    };
    const [joined] = selectRankedCities(
      [
        { properties: { JPT_KOD_JE: "146502_8" }, geometry, srsName: "EPSG:4326" },
        { properties: { JPT_KOD_JE: "146503_8" }, geometry, srsName: "EPSG:4326" },
      ],
      [{ cityId: "1465011", name: "m.st. Warszawa", rank: 1, population: 1 }],
    );
    expect(joined.geometry.type).toBe("MultiPolygon");
    expect(joined.geometry.coordinates).toHaveLength(2);
    expect(joined.properties.prgUnitCount).toBe(2);
  });

  it("rejects unsupported feature schemas and malformed positions", async () => {
    const unsupported = await readFile(
      "data/fixtures/unsupported-schema.gml",
      "utf8",
    );
    expect(() => parseGmlFeatureCollection(unsupported, schema)).toThrow(
      "A04_Granice_miast",
    );
    expect(() => parsePosList("1 2 3", "xy")).toThrow("coordinate");
  });
});
