import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildSnapshot } from "./build-snapshot.mjs";

const files = [
  "manifest.json",
  "cities.geojson",
  "poland.geojson",
  "voivodeships.geojson",
  "validation-report.json",
];

async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(`public/data/${file}`))
          .digest("hex"),
      ]),
    ),
  );
}

await buildSnapshot();
const first = await hashes();
await buildSnapshot();
const second = await hashes();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error("Runtime snapshot is not deterministic");
}
console.log(`Deterministic snapshot verified (${files.length} files)`);
