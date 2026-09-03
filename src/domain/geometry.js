export class GeometryTransformError extends Error {}

function finitePoint(point) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every(Number.isFinite)
  ) {
    throw new GeometryTransformError("Współrzędne geometrii muszą być skończone");
  }
}

export function transformPoint([x, y], [px, py], [dx, dy], angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine * (x - px) - sine * (y - py) + px + dx,
    sine * (x - px) + cosine * (y - py) + py + dy,
  ];
}

export function inverseTransformPoint([x, y], overlay) {
  const [px, py] = overlay.pivot;
  const translatedX = x - overlay.translation[0];
  const translatedY = y - overlay.translation[1];
  const cosine = Math.cos(-overlay.angle);
  const sine = Math.sin(-overlay.angle);
  return [
    cosine * (translatedX - px) - sine * (translatedY - py) + px,
    sine * (translatedX - px) + cosine * (translatedY - py) + py,
  ];
}

function mapGeometryCoordinates(geometry, transform) {
  if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) {
    throw new GeometryTransformError(`Nieobsługiwany typ: ${geometry?.type}`);
  }
  const mapRing = (ring) =>
    ring.map((point) => {
      finitePoint(point);
      return transform(point);
    });
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates.map(mapRing) }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map(mapRing),
        ),
      };
}

export function transformGeometry(source, overlay) {
  finitePoint(overlay.pivot);
  finitePoint(overlay.translation);
  if (!Number.isFinite(overlay.angle)) {
    throw new GeometryTransformError("Kąt obrotu musi być skończony");
  }
  return mapGeometryCoordinates(source, (point) =>
    transformPoint(point, overlay.pivot, overlay.translation, overlay.angle),
  );
}

function ringArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    total +=
      ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(total / 2);
}

export function planarArea(geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce(
        (area, ring, index) =>
          area + (index === 0 ? ringArea(ring) : -ringArea(ring)),
        0,
      ),
    0,
  );
}

export const getDisplayPivot = ({ pivot, translation }) => [
  pivot[0] + translation[0],
  pivot[1] + translation[1],
];
