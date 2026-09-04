import { describe, expect, it, vi } from "vitest";
import { CriticalDataError, loadData } from "../../src/data/repository.js";

const feature = (rank) => ({
  type: "Feature",
  properties: {
    cityId: String(rank).padStart(7, "0"),
    name: `Miasto ${rank}`,
    rank,
    population: 1000,
    areaM2: 10,
    pivot: [1, 2],
  },
  geometry: {
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
  },
});

function fetchFixture(cityCount = 30, missing = []) {
  const values = {
    "/data/manifest.json": {
      crs: "EPSG:2180",
      cityCount,
      files: {
        cities: "cities.geojson",
        poland: "poland.geojson",
        voivodeships: "voivodeships.geojson",
      },
    },
    "/data/cities.geojson": {
      type: "FeatureCollection",
      features: Array.from({ length: cityCount }, (_, index) => feature(index + 1)),
    },
    "/data/poland.geojson": { type: "FeatureCollection", features: [feature(1)] },
    "/data/voivodeships.geojson": {
      type: "FeatureCollection",
      features: Array.from({ length: 16 }, (_, index) => feature(index + 1)),
    },
  };
  return vi.fn(async (url) => ({
    ok: Boolean(values[url]) && !missing.includes(url),
    json: async () => values[url],
  }));
}

describe("local data repository", () => {
  it("loads and indexes exactly thirty local cities", async () => {
    const data = await loadData(fetchFixture());
    expect(data.cities).toHaveLength(30);
    expect(data.citiesById.get("0000001")).toBe(data.cities[0]);
  });

  it("classifies a malformed city snapshot as critical", async () => {
    await expect(loadData(fetchFixture(29))).rejects.toBeInstanceOf(CriticalDataError);
  });

  it("keeps city comparison available when both context layers are missing", async () => {
    const data = await loadData(
      fetchFixture(30, [
        "/data/poland.geojson",
        "/data/voivodeships.geojson",
      ]),
    );

    expect(data.cities).toHaveLength(30);
    expect(data.context.poland.features).toEqual([]);
    expect(data.context.voivodeships.features).toEqual([]);
    expect(data.warnings).toHaveLength(2);
    expect(data.warnings.join(" ")).toMatch(/warstw.*kontekst/i);
  });
});
