import AdmZip from "adm-zip";
import ExcelJS from "exceljs";

const REQUIRED_HEADERS = {
  cityId: "kod teryt",
  name: "nazwa",
  population: "ludność ogółem",
};
const CITY_TYPE_HEADERS = new Set([
  "rodzaj jednostki",
  "typ jednostki",
  "rodzaj",
]);

function cellValueText(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value.richText)) {
    return value.richText.map(({ text }) => text ?? "").join("");
  }
  if (value.text != null) return String(value.text);
  if (value.result != null) return String(value.result);
  return "";
}

const normalizeHeader = (value) =>
  cellValueText(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pl");

export const normalizeTeryt = (value) =>
  String(value).replace(/\D/g, "").padStart(6, "0");

export function extractPopulationWorkbook(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /\.xlsx$/i.test(entry.entryName));
  if (entries.length !== 1) {
    throw new Error(
      `Oczekiwano jednego XLSX GUS, znaleziono ${entries.length}`,
    );
  }
  return entries[0].getData();
}

function locateTypedPopulationTable(workbook) {
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const headers = new Map();
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        headers.set(normalizeHeader(cell.value), columnNumber);
      });

      const requiredColumns = Object.fromEntries(
        Object.entries(REQUIRED_HEADERS).map(([field, header]) => [
          field,
          headers.get(header),
        ]),
      );
      const cityType = [...CITY_TYPE_HEADERS]
        .map((header) => headers.get(header))
        .find(Boolean);

      if (
        Object.values(requiredColumns).every(Boolean) &&
        Number.isInteger(cityType)
      ) {
        return {
          sheet,
          headerRow: rowNumber,
          columns: { ...requiredColumns, cityType },
          citySheet: false,
        };
      }
    }
  }
}

function locateCurrentTownsTable(workbook) {
  for (const sheet of workbook.worksheets) {
    const title = Array.from({ length: Math.min(sheet.rowCount, 10) }, (_, index) =>
      sheet
        .getRow(index + 1)
        .values.slice(1)
        .map(normalizeHeader)
        .join(" "),
    ).join(" ");
    if (!title.includes("według miast") && !title.includes("by towns")) {
      continue;
    }

    for (let rowNumber = 1; rowNumber < Math.min(sheet.rowCount, 10); rowNumber += 1) {
      const columns = {};
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const first = normalizeHeader(
          sheet.getRow(rowNumber).getCell(column).value,
        );
        const second = normalizeHeader(
          sheet.getRow(rowNumber + 1).getCell(column).value,
        );
        const combined = `${first} ${second}`.trim();
        if (combined.includes("identyfikator terytorialny")) {
          columns.cityId = column;
        }
        if (first === "miasta towns" || second === "miasta towns") {
          columns.name = column;
        }
        if (
          combined.includes("ludność") &&
          combined.includes("population") &&
          combined.includes("ogółem") &&
          combined.includes("total")
        ) {
          columns.population = column;
        }
      }
      if (columns.cityId && columns.name && columns.population) {
        return {
          sheet,
          headerRow: rowNumber + 1,
          columns,
          citySheet: true,
        };
      }
    }
  }
}

function locatePopulationTable(workbook) {
  const located =
    locateCurrentTownsTable(workbook) ?? locateTypedPopulationTable(workbook);
  if (located) return located;
  throw new Error(
    "Nie znaleziono obsługiwanej tabeli miast GUS",
  );
}

function isCityMarker(value) {
  const marker = normalizeHeader(value);
  return marker.includes("miasto") && !marker.includes("obszar wiejski");
}

function readNamedCityRows(workbook) {
  const { sheet, headerRow, columns, citySheet } =
    locatePopulationTable(workbook);
  const rows = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (
      citySheet
        ? !/^\d{6}\s+\d$/.test(row.getCell(columns.cityId).text.trim())
        : !isCityMarker(row.getCell(columns.cityType).text)
    ) {
      continue;
    }
    rows.push({
      teryt: row.getCell(columns.cityId).value,
      name: row.getCell(columns.name).text,
      population: row.getCell(columns.population).value,
    });
  }
  return rows;
}

export async function extractPopulationRanking(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const records = readNamedCityRows(workbook)
    .map((row) => ({
      name: row.name.trim(),
      cityId: normalizeTeryt(row.teryt),
      population: Number(row.population),
    }))
    .filter(
      (row) =>
        row.name &&
        /^\d{6,7}$/.test(row.cityId) &&
        Number.isInteger(row.population) &&
        row.population > 0,
    )
    .sort(
      (a, b) =>
        b.population - a.population || a.cityId.localeCompare(b.cityId),
    );

  const duplicate = records.find(
    (record, index) =>
      index > 0 &&
      records.slice(0, index).some(({ cityId }) => cityId === record.cityId),
  );
  if (duplicate) {
    throw new Error(`Powielony kod TERYT miasta: ${duplicate.cityId}`);
  }
  if (records.length < 30) {
    throw new Error(`Oczekiwano co najmniej 30 miast GUS, znaleziono ${records.length}`);
  }

  return records
    .slice(0, 30)
    .map((record, index) => ({ rank: index + 1, ...record }));
}
