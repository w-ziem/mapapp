// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as snapshotBuilder from "../../scripts/data/build-snapshot.mjs";

it("rejects a raw artifact whose SHA-256 differs from the committed source lock", async () => {
  const rawDir = await mkdtemp(join(tmpdir(), "mapapp-raw-"));
  const fileName = "source.bin";
  const expectedBytes = Buffer.from("official bytes");
  await writeFile(join(rawDir, fileName), "tampered bytes");
  const sourceLock = {
    sources: [{
      id: "official-source",
      artifacts: [{
        fileName,
        sha256: createHash("sha256").update(expectedBytes).digest("hex"),
      }],
    }],
  };

  try {
    expect(snapshotBuilder.verifyRawSources).toBeTypeOf("function");
    await expect(snapshotBuilder.verifyRawSources(sourceLock, rawDir)).rejects.toThrow(
      /SHA-256 mismatch.*source\.bin/i,
    );
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});
