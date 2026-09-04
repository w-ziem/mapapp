import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPopulationRanking } from "./gus.mjs";
import { parseGmlFeatureCollection } from "./gml.mjs";
import {
  geometryArea,
  geometryPivot,
  projectGeometry,
  selectRankedCities,
  simplifyCityGeometry,
  simplifyTopologyPreserving,
} from "./geometry.mjs";
import { stableStringify } from "./stable-json.mjs";
import { validateSnapshot } from "./validate.mjs";

const rawDirectory = "data/raw";
const outputDirectory = "public/data";
const sourceSchema = {
  geometryProperty: "msGeometry",
  idProperty: "JPT_KOD_JE",
  nameProperty: "JPT_NAZWA_",
  sourceCrs: "EPSG:4326",
  axisOrder: "yx",
};

const featureCollection = (features) => ({
  type: "FeatureCollection",
  features,
});

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export async function verifyRawSources(sourceLock, rawDir = rawDirectory) {
  for (const source of sourceLock.sources ?? []) {
    for (const artifact of source.artifacts ?? []) {
      const bytes = await readFile(resolve(rawDir, artifact.fileName));
      const actual = sha256(bytes);
      if (actual !== artifact.sha256) {
        throw new Error(
          `SHA-256 mismatch for raw input ${artifact.fileName}: expected ${artifact.sha256}, received ${actual}`,
        );
      }
    }
  }
}

async function writeSnapshotFile(path, content) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { force: true });
      await rename(temporaryPath, path);
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 100 * (attempt + 1)),
      );
    }
  }
}

function projectedFeature(feature, properties, tolerance) {
  const projected = projectGeometry(feature.geometry, feature.srsName, "EPSG:2180");
  return {
    type: "Feature",
    properties,
    geometry: simplifyTopologyPreserving(projected, tolerance),
  };
}

export async function buildSnapshot({
  rawDir = rawDirectory,
  outputDir = outputDirectory,
} = {}) {
  const sourceLock = JSON.parse(
    await readFile("data/sources.lock.json", "utf8"),
  );
  await verifyRawSources(sourceLock, rawDir);
  const [workbook, cityXml, voivodeshipXml, polandXml] = await Promise.all([
      readFile(`${rawDir}/powierzchnia_i_ludnosc_w_przekroju_terytorialnym_2026_2.xlsx`),
      readFile(`${rawDir}/prg-A04-Granice-miast.gml`, "utf8"),
      readFile(`${rawDir}/prg-A01-Granice-wojewodztw.gml`, "utf8"),
      readFile(`${rawDir}/prg-A00-Granice-panstwa.gml`, "utf8"),
    ]);

  const ranking = await extractPopulationRanking(workbook);
  const cityFeatures = parseGmlFeatureCollection(cityXml, {
    ...sourceSchema,
    featureType: "A04_Granice_miast",
  });
  const ranked = selectRankedCities(cityFeatures, ranking).map((feature) => {
    const projected = projectGeometry(feature.geometry, feature.srsName, "EPSG:2180");
    const simplified = simplifyCityGeometry(projected);
    return {
      type: "Feature",
      properties: {
        ...feature.properties,
        areaM2: Math.round(geometryArea(projected)),
        pivot: geometryPivot(projected).map((value) => Math.round(value * 10) / 10),
        simplificationToleranceM: simplified.tolerance,
      },
      geometry: simplified.geometry,
    };
  });

  const voivodeships = parseGmlFeatureCollection(voivodeshipXml, {
    ...sourceSchema,
    featureType: "A01_Granice_wojewodztw",
  }).map((feature) =>
    projectedFeature(feature, {
      id: feature.properties.JPT_KOD_JE,
      name: feature.properties.JPT_NAZWA_,
    }, 200),
  );
  const poland = parseGmlFeatureCollection(polandXml, {
    ...sourceSchema,
    featureType: "A00_Granice_panstwa",
  }).map((feature) =>
    projectedFeature(feature, {
      id: feature.properties.JPT_KOD_JE,
      name: feature.properties.JPT_NAZWA_ || "Polska",
    }, 300),
  );

  const collections = {
    cities: featureCollection(ranked),
    poland: featureCollection(poland),
    voivodeships: featureCollection(voivodeships),
  };
  const serializedCollections = Object.fromEntries(
    Object.entries(collections).map(([name, value]) => [
      name,
      stableStringify(value),
    ]),
  );
  const manifest = {
    version: 1,
    crs: "EPSG:2180",
    cityCount: ranked.length,
    populationValidAt: "2025-12-31",
    sources: sourceLock.sources,
    files: {
      cities: "cities.geojson",
      poland: "poland.geojson",
      voivodeships: "voivodeships.geojson",
      validation: "validation-report.json",
    },
    outputs: Object.fromEntries(
      Object.entries(serializedCollections).map(([name, content]) => [
        name,
        { sha256: sha256(content) },
      ]),
    ),
  };
  manifest.outputs.validation = { sha256: "0".repeat(64) };
  const snapshot = {
    manifest,
    ...collections,
  };
  const validation = validateSnapshot(snapshot);
  const validationContent = stableStringify({
    ...validation,
    populationValidAt: manifest.populationValidAt,
  });
  manifest.outputs.validation.sha256 = sha256(validationContent);

  await mkdir(outputDir, { recursive: true });
  const files = [
    ["manifest.json", manifest],
    ["cities.geojson", serializedCollections.cities],
    ["poland.geojson", serializedCollections.poland],
    ["voivodeships.geojson", serializedCollections.voivodeships],
    ["validation-report.json", validationContent],
  ];
  for (const [name, value] of files) {
    await writeSnapshotFile(
      `${outputDir}/${name}`,
      typeof value === "string" ? value : stableStringify(value),
    );
  }
  return { ...snapshot, validation };
}

async function main() {
  const snapshot = await buildSnapshot();
  console.log(
    `Built ${snapshot.validation.cityCount} cities, ${snapshot.validation.voivodeshipCount} voivodeships in ${snapshot.manifest.crs}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
