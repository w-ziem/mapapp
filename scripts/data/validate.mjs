import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geometryArea, validateGeometryTopology } from "./geometry.mjs";

function coordinatesFinite(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 2 && value.every(Number.isFinite)) return true;
  return value.length > 0 && value.every(coordinatesFinite);
}

const PROVENANCE_FIELDS = [
  "institution",
  "dataset",
  "landingPage",
  "retrievedAt",
  "validAt",
  "license",
  "attribution",
];
const OUTPUT_NAMES = ["cities", "poland", "voivodeships", "validation"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function validateManifest(manifest) {
  if (manifest?.crs !== "EPSG:2180") {
    throw new Error("Snapshot CRS must be EPSG:2180");
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error("Runtime manifest requires source provenance");
  }
  manifest.sources.forEach((source, index) => {
    for (const field of PROVENANCE_FIELDS) {
      if (typeof source[field] !== "string" || !source[field].trim()) {
        throw new Error(`Source ${index + 1} requires non-empty ${field}`);
      }
    }
    if (!Array.isArray(source.artifacts) || source.artifacts.length === 0) {
      throw new Error(`Source ${index + 1} requires artifacts`);
    }
    source.artifacts.forEach((artifact) => {
      if (
        typeof artifact.effectiveUrl !== "string" ||
        !artifact.effectiveUrl.trim()
      ) {
        throw new Error(`Source ${index + 1} artifact requires effectiveUrl`);
      }
      if (!SHA256_PATTERN.test(artifact.sha256)) {
        throw new Error(`Source ${index + 1} artifact requires SHA-256`);
      }
    });
  });
  for (const name of OUTPUT_NAMES) {
    if (
      typeof manifest.files?.[name] !== "string" ||
      !SHA256_PATTERN.test(manifest.outputs?.[name]?.sha256)
    ) {
      throw new Error(`Runtime output ${name} requires file and SHA-256`);
    }
  }
}

export function validateOutputHashes(manifest, outputContents) {
  for (const name of OUTPUT_NAMES) {
    if (!(name in outputContents)) {
      throw new Error(`Missing runtime output bytes for ${name}`);
    }
    const actual = createHash("sha256")
      .update(outputContents[name])
      .digest("hex");
    if (actual !== manifest.outputs[name].sha256) {
      throw new Error(`SHA-256 mismatch for runtime output ${name}`);
    }
  }
}

function validateFeatureGeometry(feature, label) {
  if (!feature || feature.type !== "Feature") throw new Error(`${label}: invalid feature`);
  if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
    throw new Error(`${label}: unsupported geometry type`);
  }
  if (!coordinatesFinite(feature.geometry.coordinates)) {
    throw new Error(`${label}: non-finite or empty coordinates`);
  }
  validateGeometryTopology(feature.geometry, label);
  if (!(geometryArea(feature.geometry) > 0)) {
    throw new Error(`${label}: non-positive geometry area`);
  }
}

export function validateSnapshot({ manifest, cities, poland, voivodeships }) {
  validateManifest(manifest);
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
  const names = {
    manifest: "manifest.json",
    cities: "cities.geojson",
    poland: "poland.geojson",
    voivodeships: "voivodeships.geojson",
    validation: "validation-report.json",
  };
  const contents = Object.fromEntries(
    await Promise.all(
      Object.entries(names).map(async ([key, name]) => [
        key,
        await readFile(`${directory}/${name}`),
      ]),
    ),
  );
  const manifest = JSON.parse(contents.manifest);
  const snapshot = {
    manifest,
    cities: JSON.parse(contents.cities),
    poland: JSON.parse(contents.poland),
    voivodeships: JSON.parse(contents.voivodeships),
  };
  const validation = validateSnapshot(snapshot);
  validateOutputHashes(manifest, contents);
  console.log(JSON.stringify(validation, null, 2));
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
