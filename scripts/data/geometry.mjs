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

const pointsEqual = (first, second) =>
  first[0] === second[0] && first[1] === second[1];

function orientation(first, second, third) {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  );
}

function pointOnSegment(point, start, end) {
  return (
    orientation(start, end, point) === 0 &&
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
  if (
    Math.sign(firstSideStart) !== Math.sign(firstSideEnd) &&
    Math.sign(secondSideStart) !== Math.sign(secondSideEnd) &&
    firstSideStart !== 0 &&
    firstSideEnd !== 0 &&
    secondSideStart !== 0 &&
    secondSideEnd !== 0
  ) {
    return true;
  }
  return (
    pointOnSegment(secondStart, firstStart, firstEnd) ||
    pointOnSegment(secondEnd, firstStart, firstEnd) ||
    pointOnSegment(firstStart, secondStart, secondEnd) ||
    pointOnSegment(firstEnd, secondStart, secondEnd)
  );
}

function ringSelfIntersects(ring) {
  for (let first = 0; first < ring.length - 1; first += 1) {
    for (let second = first + 2; second < ring.length - 1; second += 1) {
      if (first === 0 && second === ring.length - 2) continue;
      if (
        segmentsIntersect(
          ring[first],
          ring[first + 1],
          ring[second],
          ring[second + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function ringsIntersect(firstRing, secondRing) {
  for (let first = 0; first < firstRing.length - 1; first += 1) {
    for (let second = 0; second < secondRing.length - 1; second += 1) {
      if (
        segmentsIntersect(
          firstRing[first],
          firstRing[first + 1],
          secondRing[second],
          secondRing[second + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function pointInRing(point, ring) {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 2;
    current < ring.length - 1;
    previous = current, current += 1
  ) {
    const [currentX, currentY] = ring[current];
    const [previousX, previousY] = ring[previous];
    if (
      currentY > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentY)) /
          (previousY - currentY) +
          currentX
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function validateRing(ring, label) {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error(`${label}: ring requires at least four coordinates`);
  }
  if (!pointsEqual(ring[0], ring.at(-1))) {
    throw new Error(`${label}: ring is not closed`);
  }
  if (new Set(ring.slice(0, -1).map((point) => point.join(","))).size < 3) {
    throw new Error(`${label}: ring requires at least three distinct points`);
  }
  if (ringSelfIntersects(ring)) {
    throw new Error(`${label}: ring has a self-intersection`);
  }
  if (!(ringMeasurement(ring).area > 0)) {
    throw new Error(`${label}: ring has zero area`);
  }
}

export function validateGeometryTopology(geometry, label = "geometry") {
  if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) {
    throw new Error(`${label}: unsupported geometry type`);
  }
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new Error(`${label}: geometry requires at least one polygon`);
  }
  polygons.forEach((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new Error(`${label}: polygon ${polygonIndex + 1} has no rings`);
    }
    polygon.forEach((ring, ringIndex) =>
      validateRing(ring, `${label}, polygon ${polygonIndex + 1}, ring ${ringIndex + 1}`),
    );
    for (let ringIndex = 1; ringIndex < polygon.length; ringIndex += 1) {
      const hole = polygon[ringIndex];
      if (ringsIntersect(polygon[0], hole) || !pointInRing(hole[0], polygon[0])) {
        throw new Error(`${label}: hole ${ringIndex} is outside or intersects its shell`);
      }
      for (let other = 1; other < ringIndex; other += 1) {
        if (
          ringsIntersect(polygon[other], hole) ||
          pointInRing(hole[0], polygon[other]) ||
          pointInRing(polygon[other][0], hole)
        ) {
          throw new Error(`${label}: holes ${other} and ${ringIndex} overlap`);
        }
      }
    }
  });
  return true;
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx || dy) {
    const t =
      ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyOpenLine(points, squaredTolerance) {
  if (points.length <= 2) return points;
  const markers = new Uint8Array(points.length);
  const stack = [[0, points.length - 1]];
  markers[0] = 1;
  markers[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop();
    let maximum = squaredTolerance;
    let selected = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = squaredSegmentDistance(
        points[index],
        points[first],
        points[last],
      );
      if (distance > maximum) {
        selected = index;
        maximum = distance;
      }
    }
    if (selected > -1) {
      markers[selected] = 1;
      stack.push([first, selected], [selected, last]);
    }
  }
  return points.filter((_point, index) => markers[index]);
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 5 || tolerance <= 0) return ring.map((point) => [...point]);
  const open = ring.slice(0, -1);
  let farthest = 1;
  let farthestDistance = 0;
  for (let index = 1; index < open.length; index += 1) {
    const dx = open[index][0] - open[0][0];
    const dy = open[index][1] - open[0][1];
    const distance = dx * dx + dy * dy;
    if (distance > farthestDistance) {
      farthest = index;
      farthestDistance = distance;
    }
  }
  const squaredTolerance = tolerance * tolerance;
  const firstHalf = simplifyOpenLine(
    open.slice(0, farthest + 1),
    squaredTolerance,
  );
  const secondHalf = simplifyOpenLine(
    [...open.slice(farthest), open[0]],
    squaredTolerance,
  );
  const simplified = [
    ...firstHalf.slice(0, -1),
    ...secondHalf.slice(0, -1),
    [...open[0]],
  ];
  return simplified.length >= 4 ? simplified : ring.map((point) => [...point]);
}

export function simplifyGeometry(geometry, tolerance) {
  const simplifyPolygon = (polygon) =>
    polygon.map((ring) => simplifyRing(ring, tolerance));
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: simplifyPolygon(geometry.coordinates) }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map(simplifyPolygon),
      };
}

export function simplifyCityGeometry(geometry, initialTolerance = 40) {
  const sourceArea = geometryArea(geometry);
  for (let tolerance = initialTolerance; tolerance >= 2.5; tolerance /= 2) {
    const simplified = simplifyGeometry(geometry, tolerance);
    const areaDelta =
      Math.abs(geometryArea(simplified) - sourceArea) / sourceArea;
    try {
      validateGeometryTopology(simplified);
      if (areaDelta <= 0.01) return { geometry: simplified, tolerance };
    } catch {
      // Retry with a smaller tolerance to preserve the source topology.
    }
  }
  validateGeometryTopology(geometry);
  return { geometry, tolerance: 0 };
}

export function simplifyTopologyPreserving(geometry, initialTolerance) {
  for (let tolerance = initialTolerance; tolerance >= 2.5; tolerance /= 2) {
    const simplified = simplifyGeometry(geometry, tolerance);
    try {
      validateGeometryTopology(simplified);
      return simplified;
    } catch {
      // Retry with a smaller tolerance to preserve the source topology.
    }
  }
  validateGeometryTopology(geometry);
  return geometry;
}

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
