// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  downloadSources,
  parseCliArgs,
} from "../../scripts/data/download.mjs";
import { stableStringify } from "../../scripts/data/stable-json.mjs";

const retrievedAt = "2026-09-03T20:00:00.000Z";
const provenance = {
  institution: "Official institution",
  dataset: "Official dataset",
  validAt: "2025-12-31",
  license: "https://example.test/license",
  attribution: "Source: Official institution; processed.",
};

it("locks explicit provenance, effective URL and SHA-256", async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url.includes("landing")) {
      return new Response(
        '<a href="/population.zip"><strong>Tablice</strong> w formacie XLSX</a>',
      );
    }
    return new Response("fixture bytes");
  });

  const lock = await downloadSources(
    {
      sources: [
        {
          id: "gus",
          kind: "landing-page",
          landingPage: "https://example.test/landing",
          linkText: "Tablice w formacie XLSX",
          ...provenance,
        },
      ],
    },
    fetchImpl,
    { now: () => new Date(retrievedAt) },
  );

  expect(lock).toMatchObject({
    version: 1,
    sources: [
      {
        id: "gus",
        ...provenance,
        landingPage: "https://example.test/landing",
        retrievedAt,
        artifacts: [
          {
            effectiveUrl: "https://example.test/population.zip",
            fileName: "population.zip",
          },
        ],
      },
    ],
  });
  expect(lock.sources[0].artifacts[0].sha256).toBe(
    createHash("sha256").update("fixture bytes").digest("hex"),
  );
});

it("validates WFS feature types before downloading EPSG:4326 GML", async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url.includes("GetCapabilities")) {
      return new Response(`<?xml version="1.0"?>
        <wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0">
          <wfs:FeatureTypeList><wfs:FeatureType>
            <wfs:Name>ms:A04_Granice_miast</wfs:Name>
          </wfs:FeatureType></wfs:FeatureTypeList>
        </wfs:WFS_Capabilities>`);
    }
    return new Response(`<?xml version="1.0"?>
      <wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
        xmlns:gml="http://www.opengis.net/gml/3.2">
        <gml:boundedBy><gml:Envelope srsName="urn:ogc:def:crs:EPSG::4326" /></gml:boundedBy>
      </wfs:FeatureCollection>`);
  });

  const lock = await downloadSources(
    {
      sources: [
        {
          id: "prg",
          kind: "wfs",
          landingPage: "https://example.test/wfs",
          endpoint: "https://example.test/wfs",
          sourceSchema: { sourceCrs: "EPSG:4326", axisOrder: "yx" },
          artifacts: [
            {
              typeName: "ms:A04_Granice_miast",
              fileName: "cities.gml",
            },
          ],
          ...provenance,
        },
      ],
    },
    fetchImpl,
    { now: () => new Date(retrievedAt) },
  );

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[0][0]).toContain("request=GetCapabilities");
  expect(fetchImpl.mock.calls[1][0]).toContain(
    "typeNames=ms%3AA04_Granice_miast",
  );
  expect(fetchImpl.mock.calls[1][0]).toContain("srsName=EPSG%3A4326");
  expect(lock.sources[0].artifacts[0].fileName).toBe("cities.gml");
});

it("removes volatile WFS timestamps before hashing and writing GML", async () => {
  const source = {
    id: "prg",
    kind: "wfs",
    landingPage: "https://example.test/wfs",
    endpoint: "https://example.test/wfs",
    sourceSchema: { sourceCrs: "EPSG:4326", axisOrder: "yx" },
    artifacts: [{ typeName: "ms:cities", fileName: "cities.gml" }],
    ...provenance,
  };
  const createFetch = (timeStamp) =>
    vi.fn(async (url) =>
      new Response(
        url.includes("GetCapabilities")
          ? `<WFS_Capabilities><FeatureTypeList><FeatureType><Name>ms:cities</Name></FeatureType></FeatureTypeList></WFS_Capabilities>`
          : `<FeatureCollection timeStamp="${timeStamp}"><boundedBy><Envelope srsName="EPSG:4326" /></boundedBy></FeatureCollection>`,
      ),
    );
  const rawDir = await mkdtemp(join(tmpdir(), "mapapp-sources-"));

  try {
    const first = await downloadSources(
      { sources: [source] },
      createFetch("2026-09-03T20:00:00"),
      { rawDir, now: () => new Date(retrievedAt) },
    );
    const second = await downloadSources(
      { sources: [source] },
      createFetch("2026-09-03T20:01:00"),
      { now: () => new Date(retrievedAt) },
    );
    const written = await readFile(join(rawDir, "cities.gml"));

    expect(written.toString("utf8")).not.toContain("timeStamp=");
    expect(createHash("sha256").update(written).digest("hex")).toBe(
      first.sources[0].artifacts[0].sha256,
    );
    expect(second.sources[0].artifacts[0].sha256).toBe(
      first.sources[0].artifacts[0].sha256,
    );
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});

it("rejects missing WFS feature types before attempting GetFeature", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(`<?xml version="1.0"?>
      <wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0">
        <wfs:FeatureTypeList />
      </wfs:WFS_Capabilities>`),
  );

  await expect(
    downloadSources(
      {
        sources: [
          {
            id: "prg",
            kind: "wfs",
            landingPage: "https://example.test/wfs",
            endpoint: "https://example.test/wfs",
            sourceSchema: { sourceCrs: "EPSG:4326", axisOrder: "yx" },
            artifacts: [{ typeName: "ms:missing", fileName: "missing.gml" }],
            ...provenance,
          },
        ],
      },
      fetchImpl,
    ),
  ).rejects.toThrow("does not declare feature type ms:missing");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("rejects a GML response that declares another CRS", async () => {
  const fetchImpl = vi.fn(async (url) =>
    new Response(
      url.includes("GetCapabilities")
        ? `<WFS_Capabilities><FeatureTypeList><FeatureType><Name>ms:cities</Name></FeatureType></FeatureTypeList></WFS_Capabilities>`
        : `<FeatureCollection><boundedBy><Envelope srsName="EPSG:2180" /></boundedBy></FeatureCollection>`,
    ),
  );

  await expect(
    downloadSources(
      {
        sources: [
          {
            id: "prg",
            kind: "wfs",
            landingPage: "https://example.test/wfs",
            endpoint: "https://example.test/wfs",
            sourceSchema: { sourceCrs: "EPSG:4326", axisOrder: "yx" },
            artifacts: [{ typeName: "ms:cities", fileName: "cities.gml" }],
            ...provenance,
          },
        ],
      },
      fetchImpl,
    ),
  ).rejects.toThrow("declares CRS EPSG:2180; expected EPSG:4326");
});

it("refuses changed source bytes unless refresh is explicit", async () => {
  const config = {
    sources: [
      {
        id: "direct",
        kind: "direct",
        landingPage: "https://example.test/about",
        artifacts: [
          {
            url: "https://example.test/source.bin",
            fileName: "source.bin",
          },
        ],
        ...provenance,
      },
    ],
  };
  const existingLock = {
    version: 1,
    sources: [
      {
        id: "direct",
        artifacts: [{ fileName: "source.bin", sha256: "0".repeat(64) }],
      },
    ],
  };
  const fetchImpl = vi.fn(async () => new Response("changed bytes"));

  const unchangedLock = structuredClone(existingLock);
  unchangedLock.sources[0].artifacts[0].sha256 = createHash("sha256")
    .update("changed bytes")
    .digest("hex");
  unchangedLock.sources[0].retrievedAt = "2026-09-01T00:00:00.000Z";
  await expect(
    downloadSources(config, fetchImpl, { existingLock: unchangedLock }),
  ).resolves.toEqual(unchangedLock);

  await expect(
    downloadSources(config, fetchImpl, { existingLock }),
  ).rejects.toThrow("changed; rerun with --refresh");

  await expect(
    downloadSources(config, fetchImpl, { existingLock, refresh: true }),
  ).resolves.toMatchObject({ sources: [{ id: "direct" }] });
});

it("serializes lock data deterministically and parses portable CLI flags", () => {
  expect(stableStringify({ z: 1, a: { d: 2, b: 3 } })).toBe(
    '{\n  "a": {\n    "b": 3,\n    "d": 2\n  },\n  "z": 1\n}\n',
  );
  expect(
    parseCliArgs([
      "--refresh",
      "--config",
      "custom config.json",
      "--lock",
      "custom lock.json",
      "--raw-dir",
      "raw files",
    ]),
  ).toEqual({
    refresh: true,
    configPath: "custom config.json",
    lockPath: "custom lock.json",
    rawDir: "raw files",
  });
  expect(() => parseCliArgs(["--unknown"])).toThrow(
    "Unknown argument: --unknown",
  );
});

it("keeps the default download set limited to runtime inputs", async () => {
  const config = JSON.parse(
    await readFile("data/sources.config.json", "utf8"),
  );
  const lock = JSON.parse(
    await readFile("data/sources.lock.json", "utf8"),
  );

  expect(config.sources.map(({ id }) => id)).toEqual([
    "gus-population-2025-12-31",
    "prg-administrative-boundaries",
  ]);
  expect(lock.sources.map(({ id }) => id)).toEqual([
    "gus-population-2025-12-31",
    "prg-administrative-boundaries",
  ]);
  expect(
    lock.sources.flatMap(({ artifacts }) =>
      artifacts.map(({ fileName }) => fileName),
    ),
  ).not.toContain("bdot10k-OT_SWRS_L.parquet");
});
