import proj4 from "proj4";
import { normalizeTeryt } from "./gus.mjs";

proj4.defs(
  "EPSG:2180",
  "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs",
);

function mapGeometry(geometry, transform) {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => ring.map(transform)),
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map(transform)),
      ),
    };
  }
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

export function projectGeometry(geometry, sourceCrs, targetCrs = "EPSG:2180") {
  return mapGeometry(geometry, (coordinate) =>
    proj4(sourceCrs, targetCrs, coordinate).map(
      (value) => Math.round(value * 10) / 10,
    ),
  );
}

function ringMeasurement(ring) {
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }
  const signedArea = twiceArea / 2;
  return {
    area: Math.abs(signedArea),
    centroid:
      signedArea === 0
        ? ring[0]
        : [centroidX / (6 * signedArea), centroidY / (6 * signedArea)],
  };
}

function polygonMeasurement(polygon) {
  let area = 0;
  let weightedX = 0;
  let weightedY = 0;
  polygon.forEach((ring, index) => {
    const measured = ringMeasurement(ring);
    const weight = index === 0 ? measured.area : -measured.area;
    area += weight;
    weightedX += measured.centroid[0] * weight;
    weightedY += measured.centroid[1] * weight;
  });
  if (!(area > 0)) throw new Error("Geometry has non-positive area");
  return { area, centroid: [weightedX / area, weightedY / area] };
}

function geometryMeasurement(geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const polygon of polygons) {
    const measured = polygonMeasurement(polygon);
    area += measured.area;
    weightedX += measured.centroid[0] * measured.area;
    weightedY += measured.centroid[1] * measured.area;
  }
  return { area, centroid: [weightedX / area, weightedY / area] };
}

export const geometryArea = (geometry) => geometryMeasurement(geometry).area;
export const geometryPivot = (geometry) => geometryMeasurement(geometry).centroid;

export function selectRankedCities(features, ranking) {
  const byTeryt = new Map();
  for (const feature of features) {
    const key = normalizeTeryt(feature.properties.JPT_KOD_JE);
    const bucket = byTeryt.get(key) ?? [];
    bucket.push(feature);
    byTeryt.set(key, bucket);
  }
  return ranking.map((record) => {
    let matches = byTeryt.get(record.cityId) ?? [];
    let aggregated = false;
    if (!matches.length) {
      const parentPrefix = record.cityId.slice(0, 4);
      matches = features.filter((feature) => {
        const code = normalizeTeryt(feature.properties.JPT_KOD_JE);
        return (
          code.startsWith(parentPrefix) &&
          (code.endsWith("8") || code.endsWith("9"))
        );
      });
      aggregated = matches.length > 1;
    }
    if (matches.length !== 1) {
      if (!aggregated) {
        throw new Error(`TERYT ${record.cityId} has ${matches.length} PRG geometries`);
      }
    }
    if (aggregated) {
      const polygons = matches.flatMap((feature) =>
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates,
      );
      return {
        type: "Feature",
        properties: {
          ...record,
          prgUnitCount: matches.length,
        },
        geometry: { type: "MultiPolygon", coordinates: polygons },
        srsName: matches[0].srsName,
      };
    }
    return {
      ...matches[0],
      properties: { ...record },
    };
  });
}
