import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPopulationRanking } from "./gus.mjs";
import { parseGmlFeatureCollection } from "./gml.mjs";
import {
  geometryArea,
  geometryPivot,
  projectGeometry,
  selectRankedCities,
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

function projectedFeature(feature, properties) {
  return {
    type: "Feature",
    properties,
    geometry: projectGeometry(feature.geometry, feature.srsName, "EPSG:2180"),
  };
}

export async function buildSnapshot({
  rawDir = rawDirectory,
  outputDir = outputDirectory,
} = {}) {
  const [workbook, cityXml, voivodeshipXml, polandXml, sourceLock] =
    await Promise.all([
      readFile(`${rawDir}/powierzchnia_i_ludnosc_w_przekroju_terytorialnym_2026_2.xlsx`),
      readFile(`${rawDir}/prg-A04-Granice-miast.gml`, "utf8"),
      readFile(`${rawDir}/prg-A01-Granice-wojewodztw.gml`, "utf8"),
      readFile(`${rawDir}/prg-A00-Granice-panstwa.gml`, "utf8"),
      readFile("data/sources.lock.json", "utf8").then(JSON.parse),
    ]);

  const ranking = await extractPopulationRanking(workbook);
  const cityFeatures = parseGmlFeatureCollection(cityXml, {
    ...sourceSchema,
    featureType: "A04_Granice_miast",
  });
  const ranked = selectRankedCities(cityFeatures, ranking).map((feature) => {
    const projected = projectGeometry(feature.geometry, feature.srsName, "EPSG:2180");
    return {
      type: "Feature",
      properties: {
        ...feature.properties,
        areaM2: Math.round(geometryArea(projected)),
        pivot: geometryPivot(projected).map((value) => Math.round(value * 10) / 10),
      },
      geometry: projected,
    };
  });

  const voivodeships = parseGmlFeatureCollection(voivodeshipXml, {
    ...sourceSchema,
    featureType: "A01_Granice_wojewodztw",
  }).map((feature) =>
    projectedFeature(feature, {
      id: feature.properties.JPT_KOD_JE,
      name: feature.properties.JPT_NAZWA_,
    }),
  );
  const poland = parseGmlFeatureCollection(polandXml, {
    ...sourceSchema,
    featureType: "A00_Granice_panstwa",
  }).map((feature) =>
    projectedFeature(feature, {
      id: feature.properties.JPT_KOD_JE,
      name: feature.properties.JPT_NAZWA_ || "Polska",
    }),
  );

  const manifest = {
    version: 1,
    crs: "EPSG:2180",
    cityCount: ranked.length,
    populationValidAt: "2025-12-31",
    sourceLockRetrievedAt: sourceLock.sources[0].retrievedAt,
    files: {
      cities: "cities.geojson",
      poland: "poland.geojson",
      voivodeships: "voivodeships.geojson",
      validation: "validation-report.json",
    },
  };
  const snapshot = {
    manifest,
    cities: featureCollection(ranked),
    poland: featureCollection(poland),
    voivodeships: featureCollection(voivodeships),
  };
  const validation = validateSnapshot(snapshot);

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(`${outputDir}/manifest.json`, stableStringify(manifest)),
    writeFile(`${outputDir}/cities.geojson`, stableStringify(snapshot.cities)),
    writeFile(`${outputDir}/poland.geojson`, stableStringify(snapshot.poland)),
    writeFile(
      `${outputDir}/voivodeships.geojson`,
      stableStringify(snapshot.voivodeships),
    ),
    writeFile(
      `${outputDir}/validation-report.json`,
      stableStringify({
        ...validation,
        populationValidAt: manifest.populationValidAt,
      }),
    ),
  ]);
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
