const SUPPORTED_SRS = new Map([
  ["EPSG:2180", "EPSG:2180"],
  ["urn:ogc:def:crs:EPSG::2180", "EPSG:2180"],
  ["http://www.opengis.net/def/crs/EPSG/0/2180", "EPSG:2180"],
  ["EPSG:4326", "EPSG:4326"],
  ["urn:ogc:def:crs:EPSG::4326", "EPSG:4326"],
  ["http://www.opengis.net/def/crs/EPSG/0/4326", "EPSG:4326"],
]);

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeSrsName(srsName) {
  const normalized = SUPPORTED_SRS.get(srsName);
  if (!normalized) throw new Error(`Unsupported GML CRS: ${srsName}`);
  return normalized;
}

export function parsePosList(text, axisOrder, dimension = 2) {
  if (dimension !== 2) throw new Error(`Unsupported coordinate dimension: ${dimension}`);
  if (axisOrder !== "xy" && axisOrder !== "yx") {
    throw new Error(`Unsupported coordinate axis order: ${axisOrder}`);
  }
  const values = String(text).trim().split(/\s+/).map(Number);
  if (values.length < 4 || values.length % 2 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Malformed GML coordinate list");
  }
  const coordinates = [];
  for (let index = 0; index < values.length; index += 2) {
    coordinates.push(
      axisOrder === "xy"
        ? [values[index], values[index + 1]]
        : [values[index + 1], values[index]],
    );
  }
  return coordinates;
}

function scalarProperty(featureXml, property, required = true) {
  if (!property) return null;
  const match = featureXml.match(
    new RegExp(`<(?:\\w+:)?${escapeRegExp(property)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegExp(property)}>`, "i"),
  );
  if (!match && required) throw new Error(`Missing GML property ${property}`);
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : null;
}

function parseRing(container, axisOrder) {
  const position = container.match(
    /<(?:\w+:)?posList\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?posList>/i,
  );
  if (!position) throw new Error("Missing GML coordinate list");
  const dimension = Number(position[1].match(/srsDimension=["'](\d+)["']/i)?.[1] ?? 2);
  const ring = parsePosList(position[2], axisOrder, dimension);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error("GML polygon ring is not closed");
  }
  return ring;
}

function parsePolygon(xml, axisOrder) {
  const exterior = xml.match(
    /<(?:\w+:)?exterior\b[^>]*>([\s\S]*?)<\/(?:\w+:)?exterior>/i,
  );
  if (!exterior) throw new Error("GML Polygon has no exterior ring");
  const rings = [parseRing(exterior[1], axisOrder)];
  for (const match of xml.matchAll(
    /<(?:\w+:)?interior\b[^>]*>([\s\S]*?)<\/(?:\w+:)?interior>/gi,
  )) {
    rings.push(parseRing(match[1], axisOrder));
  }
  return rings;
}

function parseGeometry(xml, schema) {
  const geometryMatch = xml.match(
    new RegExp(`<(?:\\w+:)?${escapeRegExp(schema.geometryProperty)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegExp(schema.geometryProperty)}>`, "i"),
  );
  if (!geometryMatch) throw new Error(`Missing GML geometry ${schema.geometryProperty}`);
  const geometryXml = geometryMatch[1];
  const srsName = geometryXml.match(/srsName=["']([^"']+)["']/i)?.[1];
  const normalizedSrs = normalizeSrsName(srsName);
  if (normalizedSrs !== schema.sourceCrs) {
    throw new Error(`GML CRS ${normalizedSrs} does not match ${schema.sourceCrs}`);
  }

  const multi = geometryXml.match(
    /<(?:\w+:)?(?:MultiSurface|MultiPolygon)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:MultiSurface|MultiPolygon)>/i,
  );
  if (multi) {
    const polygons = [...multi[1].matchAll(
      /<(?:\w+:)?Polygon\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Polygon>/gi,
    )].map((match) => parsePolygon(match[1], schema.axisOrder));
    if (!polygons.length) throw new Error("GML multi geometry has no polygons");
    return {
      geometry: { type: "MultiPolygon", coordinates: polygons },
      srsName: normalizedSrs,
    };
  }

  const polygon = geometryXml.match(
    /<(?:\w+:)?Polygon\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Polygon>/i,
  );
  if (!polygon) throw new Error("Unsupported GML geometry type");
  return {
    geometry: { type: "Polygon", coordinates: parsePolygon(polygon[1], schema.axisOrder) },
    srsName: normalizedSrs,
  };
}

export function parseGmlFeatureCollection(xml, schema) {
  const members = [...String(xml).matchAll(
    /<(?:wfs:)?member\b[^>]*>([\s\S]*?)<\/(?:wfs:)?member>/gi,
  )];
  const featurePattern = new RegExp(
    `<(?:\\w+:)?${escapeRegExp(schema.featureType)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegExp(schema.featureType)}>`,
    "i",
  );
  const features = [];
  for (const member of members) {
    const feature = member[1].match(featurePattern);
    if (!feature) continue;
    const parsed = parseGeometry(feature[1], schema);
    features.push({
      type: "Feature",
      properties: {
        [schema.idProperty]: scalarProperty(feature[1], schema.idProperty),
        [schema.nameProperty]: scalarProperty(feature[1], schema.nameProperty, false),
      },
      geometry: parsed.geometry,
      srsName: parsed.srsName,
    });
  }
  if (!features.length) {
    throw new Error(`No ${schema.featureType} features found in GML`);
  }
  return features;
}
