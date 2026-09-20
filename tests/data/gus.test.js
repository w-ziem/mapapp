// @vitest-environment node

import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  extractPopulationRanking,
  extractPopulationWorkbook,
  normalizeTeryt,
} from "../../scripts/data/gus.mjs";

describe("GUS population adapter", () => {
  it("normalizes TERYT and deterministically resolves population ties", async () => {
    expect(normalizeTeryt(146501)).toBe("146501");
    expect(normalizeTeryt("02-64-01")).toBe("026401");

    const xlsx = extractPopulationWorkbook(
      await readFile("data/fixtures/gus-population.zip"),
    );
    const rows = await extractPopulationRanking(xlsx);

    expect(rows).toHaveLength(30);
    expect(new Set(rows.map(({ cityId }) => cityId)).size).toBe(30);
    expect(
      [...rows].sort(
        (a, b) =>
          b.population - a.population ||
          a.cityId.localeCompare(b.cityId),
      ),
    ).toEqual(rows);
    expect(rows.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(rows.slice(0, 2).map(({ cityId }) => cityId)).toEqual([
      "146501",
      "026401",
    ]);
    expect(rows.slice(2, 4).map(({ cityId }) => cityId)).toEqual([
      "000003",
      "000004",
    ]);
  });

  it("requires exactly one XLSX workbook in the GUS archive", () => {
    const zip = new AdmZip();
    zip.addFile("one.xlsx", Buffer.from("one"));
    zip.addFile("two.xlsx", Buffer.from("two"));

    expect(() => extractPopulationWorkbook(zip.toBuffer())).toThrow(
      "Oczekiwano jednego XLSX GUS, znaleziono 2",
    );
  });

  it("reads the current bilingual GUS towns table", async () => {
    const workbook = new ExcelJS.Workbook();
    const introduction = workbook.addWorksheet("Introduction");
    introduction.mergeCells("A1:B1");
    const sheet = workbook.addWorksheet("Tabl. 20");
    sheet.addRow([
      {
        richText: [
          { text: "TABL. 20. POWIERZCHNIA I LUDNOŚĆ WEDŁUG MIAST\n" },
          { text: "AREA AND POPULATION BY TOWNS" },
        ],
      },
    ]);
    sheet.mergeCells("A1:F1");
    sheet.addRow([]);
    sheet.addRow([
      "Identyfikator terytorialny\nTerritorial identifier",
      "Miasta\nTowns",
      "Powiaty / miasta na prawach powiatu",
      "Powierzchnia\nArea",
      "Powierzchnia\nArea",
      "Ludność\nPopulation",
    ]);
    sheet.addRow([
      "Identyfikator terytorialny\nTerritorial identifier",
      "Miasta\nTowns",
      "Powiaty / miasta na prawach powiatu",
      "w ha\nin ha",
      "w km²\nin km²",
      "ogółem\ntotal",
    ]);
    sheet.addRow(["WOJ. TESTOWE", "", "", "", "", ""]);
    sheet.addRow(["146501 1", "Warszawa testowa", "Testowy", 1, 1, 2_000_000]);
    sheet.addRow(["026401 1", "Wrocław testowy", "Testowy", 1, 1, 1_800_000]);
    sheet.addRow(["000004 4", "Miasto czwarte", "Testowy", 1, 1, 1_500_000]);
    sheet.addRow(["000003 4", "Miasto trzecie", "Testowy", 1, 1, 1_500_000]);
    for (let index = 5; index <= 32; index += 1) {
      sheet.addRow([
        `${String(index).padStart(6, "0")} 4`,
        `Miasto ${index}`,
        "Testowy",
        1,
        1,
        1_500_000 - index * 10_000,
      ]);
    }

    const rows = await extractPopulationRanking(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(rows).toHaveLength(30);
    expect(rows.slice(0, 4).map(({ cityId }) => cityId)).toEqual([
      "1465011",
      "0264011",
      "0000034",
      "0000044",
    ]);
  });
});
