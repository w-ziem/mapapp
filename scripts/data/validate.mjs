import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function coordinatesFinite(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 2 && value.every(Number.isFinite)) return true;
  return value.length > 0 && value.every(coordinatesFinite);
}

function validateFeatureGeometry(feature, label) {
  if (!feature || feature.type !== "Feature") throw new Error(`${label}: invalid feature`);
  if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
    throw new Error(`${label}: unsupported geometry type`);
  }
  if (!coordinatesFinite(feature.geometry.coordinates)) {
    throw new Error(`${label}: non-finite or empty coordinates`);
  }
}

export function validateSnapshot({ manifest, cities, poland, voivodeships }) {
  if (manifest?.crs !== "EPSG:2180") throw new Error("Snapshot CRS must be EPSG:2180");
  if (manifest.cityCount !== 30 || cities?.features?.length !== 30) {
    throw new Error("Snapshot must contain exactly 30 cities");
  }
  const ids = new Set();
  cities.features.forEach((feature, index) => {
    validateFeatureGeometry(feature, `city ${index + 1}`);
    const properties = feature.properties ?? {};
    if (!properties.cityId || ids.has(properties.cityId)) {
      throw new Error(`Duplicate or missing cityId: ${properties.cityId}`);
    }
    ids.add(properties.cityId);
    if (
      properties.rank !== index + 1 ||
      !properties.name ||
      !(properties.population > 0) ||
      !(properties.areaM2 > 0) ||
      !Array.isArray(properties.pivot) ||
      !properties.pivot.every(Number.isFinite)
    ) {
      throw new Error(`Invalid city properties for ${properties.name ?? index + 1}`);
    }
  });
  if (poland?.features?.length !== 1) throw new Error("Poland context must contain one feature");
  if (voivodeships?.features?.length !== 16) {
    throw new Error("Voivodeship context must contain 16 features");
  }
  poland.features.forEach((feature) => validateFeatureGeometry(feature, "Poland"));
  voivodeships.features.forEach((feature, index) =>
    validateFeatureGeometry(feature, `voivodeship ${index + 1}`),
  );
  return {
    valid: true,
    crs: manifest.crs,
    cityCount: cities.features.length,
    uniqueCityIds: ids.size,
    voivodeshipCount: voivodeships.features.length,
    polygonTypes: [...new Set(cities.features.map(({ geometry }) => geometry.type))].sort(),
  };
}

async function main() {
  const directory = "public/data";
  const [manifest, cities, poland, voivodeships] = await Promise.all(
    ["manifest.json", "cities.geojson", "poland.geojson", "voivodeships.geojson"].map(
      async (name) => JSON.parse(await readFile(`${directory}/${name}`, "utf8")),
    ),
  );
  console.log(JSON.stringify(validateSnapshot({ manifest, cities, poland, voivodeships }), null, 2));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
