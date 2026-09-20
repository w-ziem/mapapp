import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { SOURCE_LOCK_VERSION, WFS_VERSION } from "./contracts.mjs";
import { stableStringify } from "./stable-json.mjs";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});
const PROVENANCE_FIELDS = [
  "institution",
  "dataset",
  "landingPage",
  "validAt",
  "license",
  "attribution",
];

function assertSuccessful(response, url) {
  if (!response?.ok) {
    throw new Error(
      `Download failed for ${url}: HTTP ${response?.status ?? "unknown"}`,
    );
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizedLinkText(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function findLandingPageArtifact(html, landingPage, linkText) {
  const matches = [];
  const anchorPattern =
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    if (normalizedLinkText(match[3]).includes(linkText)) {
      matches.push(new URL(decodeHtml(match[2]), landingPage).href);
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `No link containing "${linkText}" found at ${landingPage}`,
    );
  }
  return matches[0];
}

function collectValuesByKey(value, wantedKey, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectValuesByKey(item, wantedKey, result);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === wantedKey && typeof child !== "object") {
        result.push(String(child));
      }
      collectValuesByKey(child, wantedKey, result);
    }
  }
  return result;
}

function parseXml(xml, context) {
  try {
    return xmlParser.parse(xml);
  } catch (error) {
    throw new Error(`Invalid XML from ${context}: ${error.message}`, {
      cause: error,
    });
  }
}

function declaredFeatureTypes(capabilitiesXml, endpoint) {
  const parsed = parseXml(capabilitiesXml, endpoint);
  return new Set(collectValuesByKey(parsed, "Name"));
}

function normalizeCrs(value) {
  const match = String(value).match(
    /EPSG(?:(?:::|:)|\/0\/)(\d+)$/i,
  );
  return match ? `EPSG:${match[1]}` : String(value);
}

function assertExpectedCrs(gml, expectedCrs, url) {
  const parsed = parseXml(gml, url);
  const declared = [
    ...new Set(
      collectValuesByKey(parsed, "@_srsName").map((value) =>
        normalizeCrs(value),
      ),
    ),
  ];
  if (declared.length === 0) {
    throw new Error(`GML response from ${url} does not declare a CRS`);
  }
  const unexpected = declared.find((crs) => crs !== expectedCrs);
  if (unexpected) {
    throw new Error(
      `GML response from ${url} declares CRS ${unexpected}; expected ${expectedCrs}`,
    );
  }
}

function buildWfsUrl(endpoint, request, extra = {}) {
  const url = new URL(endpoint);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", WFS_VERSION);
  url.searchParams.set("request", request);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

function artifactFileName(response, requestedUrl, configuredName) {
  if (configuredName) return configuredName;
  const disposition = response.headers?.get("content-disposition") ?? "";
  const headerMatch = disposition.match(
    /filename\*?=(?:UTF-8''|["']?)([^"';]+)["']?/i,
  );
  if (headerMatch) return decodeURIComponent(headerMatch[1]);
  return basename(new URL(response.url || requestedUrl).pathname);
}

function normalizeWfsGml(gml) {
  return gml.replace(
    /(<(?:\w+:)?FeatureCollection\b[^>]*?)\s+timeStamp=(["'])[^"']*\2/i,
    "$1",
  );
}

async function fetchArtifact(url, fileName, fetchImpl, validate, transform) {
  const response = await fetchImpl(url);
  assertSuccessful(response, url);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (transform) bytes = Buffer.from(transform(bytes.toString("utf8")), "utf8");
  if (validate) validate(bytes.toString("utf8"));
  return {
    bytes,
    lock: {
      effectiveUrl: response.url || url,
      fileName: artifactFileName(response, url, fileName),
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function validateSource(source) {
  if (!source.id || !source.kind) {
    throw new Error("Every source requires non-empty id and kind");
  }
  for (const field of PROVENANCE_FIELDS) {
    if (typeof source[field] !== "string" || !source[field].trim()) {
      throw new Error(`Source ${source.id} requires non-empty ${field}`);
    }
  }
  if (
    source.kind === "wfs" &&
    (source.sourceSchema?.sourceCrs !== "EPSG:4326" ||
      source.sourceSchema?.axisOrder !== "yx")
  ) {
    throw new Error(
      `WFS source ${source.id} must declare EPSG:4326 with yx axis order`,
    );
  }
}

async function downloadLandingSource(source, fetchImpl) {
  const landingResponse = await fetchImpl(source.landingPage);
  assertSuccessful(landingResponse, source.landingPage);
  const html = await landingResponse.text();
  const artifactUrl = findLandingPageArtifact(
    html,
    landingResponse.url || source.landingPage,
    source.linkText,
  );
  return [
    await fetchArtifact(artifactUrl, source.fileName, fetchImpl),
  ];
}

async function downloadWfsSource(source, fetchImpl) {
  const capabilitiesUrl = buildWfsUrl(source.endpoint, "GetCapabilities");
  const capabilitiesResponse = await fetchImpl(capabilitiesUrl);
  assertSuccessful(capabilitiesResponse, capabilitiesUrl);
  const featureTypes = declaredFeatureTypes(
    await capabilitiesResponse.text(),
    capabilitiesUrl,
  );
  for (const artifact of source.artifacts) {
    if (!featureTypes.has(artifact.typeName)) {
      throw new Error(
        `WFS ${source.endpoint} does not declare feature type ${artifact.typeName}`,
      );
    }
  }

  const downloaded = [];
  for (const artifact of source.artifacts) {
    const artifactUrl = buildWfsUrl(source.endpoint, "GetFeature", {
      typeNames: artifact.typeName,
      srsName: source.sourceSchema.sourceCrs,
      outputFormat: "application/gml+xml; version=3.2",
    });
    downloaded.push(
      await fetchArtifact(
        artifactUrl,
        artifact.fileName,
        fetchImpl,
        (gml) =>
          assertExpectedCrs(gml, source.sourceSchema.sourceCrs, artifactUrl),
        normalizeWfsGml,
      ),
    );
  }
  return downloaded;
}

async function downloadDirectSource(source, fetchImpl) {
  const downloaded = [];
  for (const artifact of source.artifacts) {
    downloaded.push(
      await fetchArtifact(artifact.url, artifact.fileName, fetchImpl),
    );
  }
  return downloaded;
}

function assertSafeRefresh(lock, existingLock, refresh) {
  if (!existingLock || refresh) return;
  for (const source of lock.sources) {
    const previousSource = existingLock.sources?.find(
      ({ id }) => id === source.id,
    );
    for (const artifact of source.artifacts) {
      const previousArtifact = previousSource?.artifacts?.find(
        ({ fileName }) => fileName === artifact.fileName,
      );
      if (!previousArtifact) {
        throw new Error(
          `Source ${source.id}/${artifact.fileName} is new; rerun with --refresh`,
        );
      }
      if (previousArtifact.sha256 !== artifact.sha256) {
        throw new Error(
          `Source ${source.id}/${artifact.fileName} changed; rerun with --refresh`,
        );
      }
    }
  }
}

export async function downloadSources(
  config,
  fetchImpl = fetch,
  {
    existingLock,
    refresh = false,
    rawDir,
    now = () => new Date(),
  } = {},
) {
  if (!Array.isArray(config?.sources) || config.sources.length === 0) {
    throw new Error("Source config requires a non-empty sources array");
  }
  const retrievedAt = now().toISOString();
  const pendingWrites = [];
  const lockedSources = [];

  for (const source of config.sources) {
    validateSource(source);
    let downloaded;
    if (source.kind === "landing-page") {
      downloaded = await downloadLandingSource(source, fetchImpl);
    } else if (source.kind === "wfs") {
      downloaded = await downloadWfsSource(source, fetchImpl);
    } else if (source.kind === "direct") {
      downloaded = await downloadDirectSource(source, fetchImpl);
    } else {
      throw new Error(`Unsupported source kind for ${source.id}: ${source.kind}`);
    }

    pendingWrites.push(
      ...downloaded.map(({ bytes, lock }) => ({
        bytes,
        fileName: lock.fileName,
      })),
    );
    lockedSources.push({
      id: source.id,
      institution: source.institution,
      dataset: source.dataset,
      landingPage: source.landingPage,
      retrievedAt,
      validAt:
        source.validAt === "retrievedAt"
          ? retrievedAt.slice(0, 10)
          : source.validAt,
      license: source.license,
      attribution: source.attribution,
      artifacts: downloaded.map(({ lock }) => lock),
    });
  }

  const lock = { version: SOURCE_LOCK_VERSION, sources: lockedSources };
  assertSafeRefresh(lock, existingLock, refresh);
  const resultingLock = existingLock && !refresh ? existingLock : lock;

  if (rawDir) {
    await mkdir(rawDir, { recursive: true });
    for (const artifact of pendingWrites) {
      await writeFile(resolve(rawDir, artifact.fileName), artifact.bytes);
    }
  }
  return resultingLock;
}

export function parseCliArgs(args) {
  const parsed = {
    refresh: false,
    configPath: "data/sources.config.json",
    lockPath: "data/sources.lock.json",
    rawDir: "data/raw",
  };
  const valueFlags = new Map([
    ["--config", "configPath"],
    ["--lock", "lockPath"],
    ["--raw-dir", "rawDir"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--refresh") {
      parsed.refresh = true;
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const field = valueFlags.get(flag);
    if (!field) throw new Error(`Unknown argument: ${argument}`);
    const value =
      equalsIndex === -1 ? args[(index += 1)] : argument.slice(equalsIndex + 1);
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    parsed[field] = value;
  }
  return parsed;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(options.configPath, "utf8"));
  const existingLock = await readJsonIfPresent(options.lockPath);
  const lock = await downloadSources(config, fetch, {
    existingLock,
    refresh: options.refresh,
    rawDir: options.rawDir,
  });
  await writeAtomic(options.lockPath, stableStringify(lock));
  for (const source of lock.sources) {
    for (const artifact of source.artifacts) {
      console.log(
        `${source.id}: ${artifact.fileName} ${artifact.sizeBytes} bytes ${artifact.sha256}`,
      );
    }
  }
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
