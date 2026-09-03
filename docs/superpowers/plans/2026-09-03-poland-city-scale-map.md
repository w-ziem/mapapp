# Poland City Scale Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować statyczną, działającą offline aplikację Vite w vanilla JavaScript, która na atlasowej mapie Polski pozwala porównywać w tej samej skali oficjalne granice administracyjne 30 największych miast przez tworzenie, przesuwanie i obracanie niezależnych kopii.

**Architecture:** Samowystarczalny pipeline Node uruchamiany przed buildem pobiera zamrożone źródła PRG, BDOT10k i GUS, parsuje potrzebne struktury GML, reprojektuje je do EPSG:2180, naprawia, upraszcza, waliduje i zapisuje lokalny snapshot GeoJSON z manifestem. Runtime składa się z czystego silnika geometrii i reduktora, repozytorium danych, adapterów OpenLayers oraz renderera dostępnego UI; stan sesji jest jedynym źródłem prawdy, a warstwy mapy są jego projekcją.

**Tech Stack:** Node.js `>=22.18.0 <23` (zweryfikowane lokalnie: 22.18.0), npm 10.9.3, create-vite 9.2.0, Vite 8.2.2, vanilla JavaScript ES modules, OpenLayers 10.10.0, proj4 2.22.0, Vitest 5.0.0, jsdom 28.1.0, Playwright 1.62.1, `@axe-core/playwright` 4.13.0, JSTS 2.12.1, `fast-xml-parser` 5.11.1, ExcelJS 4.4.0 i `adm-zip` 0.6.0.

## Global Constraints

- Runtime jest zbiorem plików statycznych: bez API, serwera aplikacyjnego, zewnętrznych kafli i automatycznych żądań poza własny origin.
- Wszystkie fonty, ikony, etykiety i dane używane przez aplikację są lokalne i wersjonowane.
- Geometria robocza, widok, `translation: [dx, dy]` i pivot używają EPSG:2180 oraz metrów; `angle` jest w radianach, dodatni przeciwnie do ruchu wskazówek zegara.
- Obrót i obliczanie powierzchni nigdy nie odbywają się w EPSG:4326; loader OpenLayers zawsze podaje `dataProjection: "EPSG:2180"`.
- Snapshot zawiera dokładnie miejsca 1–30 rankingu GUS, sortowane malejąco po ludności i rosnąco po TERYT przy remisie; dopasowanie do `A04_Granice_miast` odbywa się wyłącznie po znormalizowanym TERYT.
- Oryginały są niemutowalne i zawsze widoczne; każda kopia powstaje z geometrii źródłowej według `p' = R(angle) × (p - pivot) + pivot + translation`.
- Pivot jest środkiem powierzchni nieuproszczonej geometrii po reprojekcji, ustalanym raz; uproszczenie miasta zachowuje topologię, liczbę części i względną powierzchnię w granicy 1%.
- Próg utworzenia kopii przez drag oryginału wynosi 6 px; suwak ma zakres −180°–180°; `[`/`]` obracają o 1°, z Shift o 15°.
- Desktop i mobile rozdziela breakpoint 768 px; mobilny arkusz ma wysokości collapsed, 45% i 85%, a każdy cel dotykowy co najmniej 44 × 44 px.
- UI i błędy użytkownika są po polsku, bez surowych stack trace; wymagany jest WCAG 2.2 AA, widoczny fokus, obsługa 200% zoom i `prefers-reduced-motion`.
- Stan sesji pozostaje wyłącznie w pamięci; kod runtime nie zapisuje kopii, selekcji ani widoku do localStorage, IndexedDB lub serwera.
- Pierwsza implementacja każdego zachowania powstaje po konkretnym, obserwowalnie czerwonym teście; testy obrazu są wyłącznie uzupełnieniem asercji funkcjonalnych.
- Komendy są zgodne z PowerShell; każda komenda jest osobnym wierszem, a sekwencje nie używają `&&`.
- Pipeline danych działa wyłącznie w Node i nie wymaga poleceń, bibliotek ani instalacji systemowych spoza `npm ci`.
- `package-lock.json` jest wersjonowany. Wersje pakietów sprawdzono 2026-09-03 przez rejestr npm; jsdom 28.1.0 jest najnowszą sprawdzoną wersją zgodną z lokalnym Node 22.18.0.
- Nie pushuj commitów. Każdy commit w zadaniach jest lokalnym, logicznym punktem kontrolnym.

---

## Docelowa struktura plików i odpowiedzialności

```text
.
├── index.html                         # semantyczny szkielet aplikacji i lokalne punkty montowania
├── package.json / package-lock.json   # dokładne zależności i skrypty
├── vite.config.js                     # statyczny build i konfiguracja Vitest
├── playwright.config.js               # E2E na zbudowanym katalogu dist
├── public/
│   └── data/
│       ├── manifest.json              # DataManifest v1, pochodzenie i sumy plików wynikowych
│       ├── cities.geojson             # 30 uproszczonych granic miast w EPSG:2180
│       ├── poland.geojson             # uproszczona granica kraju
│       ├── voivodeships.geojson       # uproszczone granice województw
│       ├── vistula.geojson             # uproszczona oś Wisły
│       ├── labels.json                 # lokalne etykiety i pozycje EPSG:2180
│       └── validation-report.json      # maszynowy raport walidacji snapshotu
├── data/
│   ├── sources.config.json             # oficjalne landing pages, endpointy i mapowanie schematów
│   ├── sources.lock.json               # efektywne URL-e, daty i SHA-256 zamrożonych wejść
│   ├── labels.config.json              # wersjonowane treści oraz pozycje etykiet
│   ├── fixtures/                       # małe legalne wycinki PRG, BDOT10k i GUS dla testów
│   └── raw/                            # pobrane paczki; ignorowane przez Git
├── scripts/data/
│   ├── contracts.mjs                   # typy i stałe DataManifest/CityFeature
│   ├── download.mjs                    # pobranie źródeł, SHA-256 i sources.lock
│   ├── gus.mjs                         # odczyt XLSX, normalizacja TERYT i ranking
│   ├── gml.mjs                         # ścisły parser potrzebnego podzbioru GML i axis order
│   ├── geometry.mjs                    # reprojekcja, make-valid i adaptacyjne uproszczenie
│   ├── build-snapshot.mjs              # deterministyczna orkiestracja wszystkich wyników
│   ├── stable-json.mjs                 # stabilne sortowanie kluczy i zapis JSON
│   ├── validate.mjs                    # wszystkie reguły sekcji 9 specyfikacji
│   └── reproduce.mjs                   # dwa czyste buildy i porównanie sum
├── src/
│   ├── main.js                         # bootstrap, retry i spięcie adapterów
│   ├── projection.js                   # rejestracja EPSG:2180
│   ├── data/repository.js              # loadData i klasyfikacja błędów źródeł
│   ├── domain/geometry.js              # czyste transformacje Polygon/MultiPolygon
│   ├── domain/state.js                 # typy stanu, initial state i czysty reducer
│   ├── domain/store.js                 # dispatch/subscription bez zależności od DOM
│   ├── map/create-map.js               # View i lokalne źródła wektorowe
│   ├── map/layers.js                   # tło, oryginały, kopie, etykiety i style
│   ├── map/sync-overlays.js             # projekcja overlays stanu do warstwy
│   ├── map/interactions.js             # drag, rotate, hit priority i anulowanie
│   ├── map/navigation.js               # fit/padding/initial view
│   ├── ui/panel.js                     # lista, search, details, actions i sources
│   ├── ui/keyboard.js                  # skróty z ochroną pól formularza
│   ├── ui/announcer.js                 # aria-live
│   ├── ui/layout.js                    # desktop panel i mobilny bottom sheet
│   └── styles.css                      # atlas, responsive layout, fokus i reduced motion
├── tests/                              # testy jednostkowe i integracyjne Vitest
├── e2e/                                # scenariusze Playwright, axe i pomocniki
├── test-results/evidence/              # ignorowane artefakty ostatniego audytu
└── README.md                           # pochodzenie danych, uruchomienie i dowody
```

### Wspólne kontrakty używane przez zadania

```js
/**
 * @typedef {[number, number]} Coordinate2180
 * @typedef {{type: "Polygon"|"MultiPolygon", coordinates: number[][][]|number[][][][]}} GeoJSONGeometry
 * @typedef {{type: "LineString", coordinates: number[][]}} GeoJSONLineString
 * @typedef {{overlayId:string, cityId:string, translation:Coordinate2180,
 *   angle:number, pivot:Coordinate2180}} OverlayState
 * @typedef {{cityId:string, name:string, rank:number, population:number,
 *   areaM2:number, pivot:Coordinate2180}} CityProperties
 * @typedef {{type:"Feature", properties:CityProperties, geometry:GeoJSONGeometry}} CityFeature
 * @typedef {{center:Coordinate2180, zoom:number, rotation:0}} ViewState
 * @typedef {"open"|"collapsed"} DesktopPanelState
 * @typedef {"collapsed"|"half"|"full"} MobilePanelState
 */
```

### Task 1: Scaffold Vite, test runner and EPSG:2180

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.gitignore`
- Create: `index.html`
- Create: `vite.config.js`
- Create: `vitest.setup.js`
- Create: `src/main.js`
- Create: `src/projection.js`
- Create: `src/styles.css`
- Test: `tests/projection.test.js`

**Interfaces:**
- Consumes: definicję EPSG:2180 `+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs`.
- Produces: `registerPolandProjection(): import("ol/proj/Projection").default` oraz skrypty `dev`, `build`, `test`, `test:watch`, `data:download`, `data:build`, `data:validate`, `data:repro`, `test:e2e`, `test:a11y`.

- [ ] **Step 1: Utwórz kontrolowany scaffold i napisz czerwony test rejestracji projekcji**

Run:

```powershell
npm create vite@9.2.0 .vite-scaffold -- --template vanilla
Copy-Item .vite-scaffold\index.html .\index.html
Copy-Item .vite-scaffold\package.json .\package.json
Remove-Item .vite-scaffold -Recurse -Force
npm install --save-exact ol@10.10.0 proj4@2.22.0
npm install --save-dev --save-exact vite@8.2.2 vitest@5.0.0 jsdom@28.1.0
```

Then create:

```js
// tests/projection.test.js
import { get as getProjection } from "ol/proj.js";
import { describe, expect, it } from "vitest";
import { registerPolandProjection } from "../src/projection.js";

describe("registerPolandProjection", () => {
  it("registers EPSG:2180 with metre units and the Poland extent", () => {
    const projection = registerPolandProjection();
    expect(getProjection("EPSG:2180")).toBe(projection);
    expect(projection.getUnits()).toBe("m");
    expect(projection.getExtent()).toEqual([100000, 100000, 900000, 850000]);
  });
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/projection.test.js`

Expected: FAIL z `Cannot find module '../src/projection.js'`.

- [ ] **Step 3: Dodaj minimalną konfigurację i implementację**

```js
// src/projection.js
import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";
import { get as getProjection } from "ol/proj.js";

export function registerPolandProjection() {
  proj4.defs("EPSG:2180", "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs");
  register(proj4);
  const projection = getProjection("EPSG:2180");
  projection.setExtent([100000, 100000, 900000, 850000]);
  return projection;
}
```

Set `"type": "module"`, `"engines": {"node": ">=22.18.0 <23", "npm": "10.9.3"}`, `"packageManager": "npm@10.9.3"` and exact scripts in `package.json`; configure `test.environment = "jsdom"` and `setupFiles = "./vitest.setup.js"` in `vite.config.js`. `src/main.js` initially calls `registerPolandProjection()` and imports `./styles.css`; `index.html` contains `<main id="app"></main>`.

- [ ] **Step 4: Uruchom GREEN i statyczny build**

Run: `npx vitest run tests/projection.test.js`

Expected: PASS, 1 test.

Run: `npm run build`

Expected: exit 0 oraz `dist/index.html` i hashowane zasoby, bez odwołań HTTP do zewnętrznych fontów lub kafli.

- [ ] **Step 5: Refactor i verification**

Run: `npm test`

Expected: PASS. Sprawdź `npm ls --depth=0`; wersje muszą odpowiadać nagłówkowi planu, bez `invalid` i `extraneous`.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .gitignore index.html vite.config.js vitest.setup.js src tests/projection.test.js
git commit -m "build: scaffold static map application"
```

### Task 2: Lock official sources and deterministic GUS ranking

**Files:**
- Create: `data/sources.config.json`
- Create: `data/sources.lock.json`
- Create: `data/fixtures/gus-population.zip`
- Create: `data/fixtures/prg-city-polygon.gml`
- Create: `data/fixtures/prg-city-multipolygon.gml`
- Create: `data/fixtures/epsg4326-axis-yx.gml`
- Create: `data/fixtures/bdot-vistula-sample.gml`
- Create: `data/fixtures/unsupported-schema.gml`
- Create: `scripts/data/contracts.mjs`
- Create: `scripts/data/stable-json.mjs`
- Create: `scripts/data/download.mjs`
- Create: `scripts/data/gus.mjs`
- Test: `tests/data/download.test.js`
- Test: `tests/data/gus.test.js`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: GUS landing page `https://stat.gov.pl/obszary-tematyczne/ludnosc/ludnosc/ludnosc-stan-i-struktura-oraz-ruch-naturalny-w-przekroju-terytorialnym-w-2025-r-stan-w-dniu-31-grudnia,6,40.html`, PRG WFS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries`, BDOT10k WFS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/BDOT/WFS/PobieranieBDOT10k`.
- Produces: `normalizeTeryt(value): string`, `extractPopulationWorkbook(zipBuffer): Buffer`, `extractPopulationRanking(xlsxBuffer): PopulationRecord[]`, `downloadSources(config, fetchImpl): Promise<SourceLock>`, gdzie `PopulationRecord = {rank:number,name:string,cityId:string,population:number}` i `SourceLock.sources[*] = {id,institution,dataset,landingPage,retrievedAt,validAt,license,attribution,artifacts:Array<{effectiveUrl,fileName,sha256}>}`.

- [ ] **Step 1: Napisz czerwone testy źródeł i rankingu**

Run:

```powershell
npm install --save-dev --save-exact fast-xml-parser@5.11.1 exceljs@4.4.0 adm-zip@0.6.0
```

```js
// tests/data/gus.test.js
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractPopulationRanking, extractPopulationWorkbook, normalizeTeryt } from "../../scripts/data/gus.mjs";

it("normalizes TERYT and deterministically resolves population ties", async () => {
  expect(normalizeTeryt(146501)).toBe("146501");
  const xlsx = extractPopulationWorkbook(await readFile("data/fixtures/gus-population.zip"));
  const rows = await extractPopulationRanking(xlsx);
  expect(rows).toHaveLength(30);
  expect(new Set(rows.map(({ cityId }) => cityId)).size).toBe(30);
  expect([...rows].sort((a, b) => b.population - a.population || a.cityId.localeCompare(b.cityId))).toEqual(rows);
  expect(rows.map(({ rank }) => rank)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
});
```

```js
// tests/data/download.test.js
import { expect, it, vi } from "vitest";
import { downloadSources } from "../../scripts/data/download.mjs";

it("locks the effective URL and SHA-256 of every downloaded source", async () => {
  const fetchImpl = vi.fn(async url => new Response(url.includes("landing") ? '<a href="/population.zip">Tablice w formacie XLSX</a>' : "fixture bytes"));
  const lock = await downloadSources({ sources: [{ id: "gus", landingPage: "https://example.test/landing", linkText: "Tablice w formacie XLSX" }] }, fetchImpl);
  expect(lock.sources[0]).toMatchObject({ id: "gus", artifacts: [{
    effectiveUrl: "https://example.test/population.zip", fileName: "population.zip"
  }] });
  expect(lock.sources[0].artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/data/gus.test.js tests/data/download.test.js`

Expected: FAIL z brakiem `scripts/data/gus.mjs` i `scripts/data/download.mjs`.

- [ ] **Step 3: Zaimplementuj minimalny, jawny adapter źródeł**

`sources.config.json` definiuje trzy źródła: `gus-population-2025-12-31`, `prg-administrative-boundaries`, `bdot10k-vistula`. Każde ma landing page, instytucję, zbiór, datę obowiązywania, licencję i atrybucję. Źródło PRG ma trzy artefakty WFS dla typów `A04_Granice_miast`, `A03_Granice_wojewodztw` i `A00_Granice_panstwa`; BDOT10k ma artefakt `OT_SWRS_L` filtrowany po `nazwaGeograficzna = "Wisła"`; mapowanie TERYT używa `JPT_KOD_JE`. Każde zapytanie WFS wymusza `srsName=EPSG:4326`, a odpowiadający `SourceSchema` zapisuje `sourceCrs:"EPSG:4326"` i formalny porządek osi WFS 2.0 `axisOrder:"yx"`; parser odrzuca odpowiedź, która deklaruje inny CRS. Dla GUS downloader wybiera link o tekście zawierającym `Tablice w formacie XLSX`; dla WFS zapisuje pełne zapytania `GetFeature` jako GML. `fast-xml-parser` sprawdza `GetCapabilities` i odrzuca brak zadeklarowanego typu przed pobraniem.

```js
// scripts/data/gus.mjs
export const normalizeTeryt = value => String(value).replace(/\D/g, "").padStart(6, "0");

export function extractPopulationWorkbook(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter(entry => /\.xlsx$/i.test(entry.entryName));
  if (entries.length !== 1) throw new Error(`Oczekiwano jednego XLSX GUS, znaleziono ${entries.length}`);
  return entries[0].getData();
}

export async function extractPopulationRanking(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find(ws =>
    ws.getSheetValues().flat(2).some(value => String(value).includes("Kod TERYT")));
  const records = readNamedCityRows(sheet)
    .map(row => ({ name: row.name.trim(), cityId: normalizeTeryt(row.teryt), population: Number(row.population) }))
    .filter(row => row.name && Number.isInteger(row.population) && row.population > 0)
    .sort((a, b) => b.population - a.population || a.cityId.localeCompare(b.cityId))
    .slice(0, 30);
  return records.map((record, index) => ({ rank: index + 1, ...record }));
}
```

`readNamedCityRows` rozpoznaje w fixture i źródle kolumny po pełnych nagłówkach `Kod TERYT`, `Nazwa` i `Ludność ogółem`, pomija sumy województw/powiatów i dopuszcza wyłącznie rekordy oznaczone przez GUS jako miasto. `download.mjs` korzysta z `fetch`, `crypto.createHash("sha256")`, zapisuje do `data/raw`, a `sources.lock.json` przez `stableStringify` z `scripts/data/stable-json.mjs`; ponowne uruchomienie z istniejącym lockiem odrzuca inną sumę, dopóki operator jawnie nie poda `--refresh`.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/data/gus.test.js tests/data/download.test.js`

Expected: PASS, dokładnie 30 unikalnych TERYT, deterministyczny tie-break i 64-znakowe SHA-256.

- [ ] **Step 5: Pobierz i zweryfikuj rzeczywisty lock**

Run: `npm run data:download -- --refresh`

Expected: exit 0; `data/sources.lock.json` ma trzy źródła i pięć artefaktów z niepustymi datami, URL-ami, licencją, atrybucją i SHA-256; `data/raw/` zawiera GUS ZIP oraz GML PRG/BDOT10k. Surowe pliki są ignorowane, fixture i lock są wersjonowane.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore package.json package-lock.json data/sources.config.json data/sources.lock.json data/fixtures scripts/data/contracts.mjs scripts/data/stable-json.mjs scripts/data/download.mjs scripts/data/gus.mjs tests/data
git commit -m "feat: lock official city data sources"
```

### Task 3: Parse GML, reproject, repair and simplify geometries

**Files:**
- Create: `scripts/data/gml.mjs`
- Create: `scripts/data/geometry.mjs`
- Create: `data/labels.config.json`
- Test: `tests/data/gml.test.js`
- Test: `tests/data/geometry.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `PopulationRecord[]`, surowe GML PRG/BDOT10k, `SourceSchema = {featureType:string,geometryProperty:string,idProperty:string|null,nameProperty:string|null,sourceCrs:string,axisOrder:"xy"|"yx"}` z `sources.config.json`, `fast-xml-parser` 5.11.1, proj4 2.22.0 i JSTS 2.12.1.
- Produces: `normalizeSrsName(srsName): "EPSG:2180"|"EPSG:4326"`, `parsePosList(text,{dimension,axisOrder}): number[][]`, `parseGmlGeometry(node,{sourceCrs,axisOrder,path}): GeoJSONGeometry`, `parseGmlFeatureCollection(xml,schema): ParsedFeature[]`, `parseBdotLineStrings(xml,schema): ParsedLineFeature[]`, `projectGeometry(geometry,{sourceCrs,axisOrder,targetCrs}): GeoJSONGeometry|GeoJSONLineString`, `selectRankedCities(features,ranking): Feature[]`, `repairGeometry(geometry): GeoJSONGeometry`, `simplifyCity(feature,initialTolerance=50): ProcessedCity`, `simplifyContext(feature,tolerance=150): Feature`, `new UnsupportedGmlSchemaError(code,path,message)`.
- `ParsedFeature = {sourceId:string|null,properties:Record<string,string>,geometry:GeoJSONGeometry,srsName:"EPSG:2180"|"EPSG:4326"}`; `ParsedLineFeature` ma ten sam kształt z `geometry:GeoJSONLineString`. `UnsupportedGmlSchemaError` ma `{name:"UnsupportedGmlSchemaError",code:"FEATURE_TYPE"|"GEOMETRY_TYPE"|"SRS_NAME"|"AXIS_ORDER"|"DIMENSION"|"POS_LIST"|"PROPERTY",path:string}`.

- [ ] **Step 1: Zainstaluj wyłącznie zależność potrzebną przez naprawę i napisz czerwone testy GML**

Run:

```powershell
npm install --save-dev --save-exact jsts@2.12.1
```

```js
// tests/data/gml.test.js
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseBdotLineStrings, parseGmlFeatureCollection } from "../../scripts/data/gml.mjs";
import { projectGeometry } from "../../scripts/data/geometry.mjs";

const prgSchema = {
  featureType: "A04_Granice_miast", geometryProperty: "geom",
  idProperty: "JPT_KOD_JE", nameProperty: "JPT_NAZWA_",
  sourceCrs: "EPSG:2180", axisOrder: "xy"
};

it("parses gml:posList Polygon, properties and srsName", async () => {
  const xml = await readFile("data/fixtures/prg-city-polygon.gml", "utf8");
  const [feature] = parseGmlFeatureCollection(xml, prgSchema);
  expect(feature.properties).toMatchObject({ JPT_KOD_JE: "066301", JPT_NAZWA_: "Lublin" });
  expect(feature.srsName).toBe("EPSG:2180");
  expect(feature.geometry).toEqual({
    type: "Polygon",
    coordinates: [[[100000, 200000], [100100, 200000], [100100, 200100],
      [100000, 200100], [100000, 200000]]]
  });
});

it("maps GML MultiSurface and MultiPolygon members to GeoJSON MultiPolygon", async () => {
  const xml = await readFile("data/fixtures/prg-city-multipolygon.gml", "utf8");
  const [feature] = parseGmlFeatureCollection(xml, prgSchema);
  expect(feature.geometry.type).toBe("MultiPolygon");
  expect(feature.geometry.coordinates).toHaveLength(2);
  expect(feature.geometry.coordinates.every(polygon => polygon[0][0].length === 2)).toBe(true);
});

it("parses the BDOT10k Wisła Curve/LineStringSegment subset", async () => {
  const xml = await readFile("data/fixtures/bdot-vistula-sample.gml", "utf8");
  const [feature] = parseBdotLineStrings(xml, {
    featureType: "OT_SWRS_L", geometryProperty: "geometria",
    idProperty: null, nameProperty: "nazwaGeograficzna",
    sourceCrs: "EPSG:4326", axisOrder: "yx"
  });
  expect(feature.properties.nazwaGeograficzna).toBe("Wisła");
  expect(feature.geometry).toEqual({ type: "LineString",
    coordinates: [[21.0, 52.0], [21.1, 52.1], [21.2, 52.2]] });
  expect(feature.srsName).toBe("EPSG:4326");
});

it("parses WFS latitude-longitude axis order and projects a known point", async () => {
  const xml = await readFile("data/fixtures/epsg4326-axis-yx.gml", "utf8");
  const [feature] = parseGmlFeatureCollection(xml, {
    ...prgSchema, sourceCrs: "EPSG:4326", axisOrder: "yx"
  });
  expect(feature.geometry.coordinates[0][0]).toEqual([21.0122, 52.2297]);
  const projected = projectGeometry(feature.geometry,
    { sourceCrs: feature.srsName, axisOrder: "xy", targetCrs: "EPSG:2180" });
  expect(projected.coordinates[0][0][0]).toBeCloseTo(637382.204, 3);
  expect(projected.coordinates[0][0][1]).toBeCloseTo(486757.209, 3);
});

it.each([
  ["unsupported feature", "data/fixtures/unsupported-schema.gml", "FEATURE_TYPE"],
  ["unknown CRS", gmlWithSrsName("EPSG:999999"), "SRS_NAME"],
  ["three dimensional positions", gmlWithDimension(3), "DIMENSION"],
  ["odd coordinate count", gmlWithPosList("1 2 3"), "POS_LIST"]
])("rejects %s with a typed schema error", async (_name, input, code) => {
  const xml = input.endsWith?.(".gml") ? await readFile(input, "utf8") : input;
  try {
    parseGmlFeatureCollection(xml, prgSchema);
    throw new Error("Parser zaakceptował nieobsługiwany schemat");
  } catch (error) {
    expect(error).toMatchObject({ name: "UnsupportedGmlSchemaError", code });
  }
});
```

- [ ] **Step 2: Napisz czerwone testy joinu, naprawy i uproszczenia**

```js
// tests/data/geometry.test.js
import { expect, it } from "vitest";
import { countParts, isValid, relativeAreaDelta, repairGeometry,
  selectRankedCities, simplifyCity, simplifyContext } from "../../scripts/data/geometry.mjs";

it("joins every ranked city to exactly one PRG feature by TERYT, never name", () => {
  const features = [prgFeature({ teryt: "146501", name: "Warszawa" }),
    prgFeature({ teryt: "066301", name: "Lublin" })];
  const ranking = [{ cityId: "066301", name: "Inna nazwa", rank: 1, population: 1 }];
  expect(selectRankedCities(features, ranking)[0].properties.cityId).toBe("066301");
  expect(() => selectRankedCities([...features, features[1]], ranking))
    .toThrow("TERYT 066301 ma 2 geometrie PRG");
});

it.each([[clockwisePolygon(), "Polygon"], [invalidMultiPolygon(), "MultiPolygon"]])(
  "repairs ring orientation and topology for %s", (geometry, expectedType) => {
    const repaired = repairGeometry(geometry);
    expect(repaired.type).toBe(expectedType);
    expect(isValid(repaired)).toBe(true);
    expect(isCounterClockwise(exteriorRing(repaired))).toBe(true);
  });

it("halves 50 m tolerance until topology, parts and 1% area are preserved", () => {
  const source = cityFixtureWhose50mSimplificationExceedsOnePercent();
  const result = simplifyCity(source, 50);
  expect(result.simplificationToleranceM).toBe(25);
  expect(result.isValid).toBe(true);
  expect(countParts(result.geometry)).toBe(countParts(source.geometry));
  expect(relativeAreaDelta(source.geometry, result.geometry)).toBeLessThanOrEqual(0.01);
  expect(result.properties.pivot.every(Number.isFinite)).toBe(true);
});

it("simplifies context geometry at 150 m and keeps it valid", () => {
  const result = simplifyContext(contextPolygonFixture(), 150);
  expect(result.simplificationToleranceM).toBe(150);
  expect(isValid(result.geometry)).toBe(true);
});
```

- [ ] **Step 3: Uruchom RED**

Run: `npx vitest run tests/data/gml.test.js tests/data/geometry.test.js`

Expected: FAIL z `Cannot find module '../../scripts/data/gml.mjs'`; żaden test nie uruchamia procesu zewnętrznego.

- [ ] **Step 4: Zaimplementuj ścisły parser i czysty pipeline geometrii**

```js
// scripts/data/gml.mjs
const SUPPORTED_SRS = new Map([
  ["EPSG:2180", "EPSG:2180"],
  ["urn:ogc:def:crs:EPSG::2180", "EPSG:2180"],
  ["http://www.opengis.net/def/crs/EPSG/0/2180", "EPSG:2180"],
  ["EPSG:4326", "EPSG:4326"],
  ["urn:ogc:def:crs:EPSG::4326", "EPSG:4326"],
  ["http://www.opengis.net/def/crs/EPSG/0/4326", "EPSG:4326"]
]);

export class UnsupportedGmlSchemaError extends Error {
  constructor(code, path, message = `Nieobsługiwany GML w ${path}`) {
    super(message);
    this.name = "UnsupportedGmlSchemaError";
    this.code = code;
    this.path = path;
  }
}

export function normalizeSrsName(srsName) {
  const normalized = SUPPORTED_SRS.get(srsName);
  if (!normalized) throw new UnsupportedGmlSchemaError("SRS_NAME", "@srsName");
  return normalized;
}

export function parsePosList(text, { dimension = 2, axisOrder }) {
  if (dimension !== 2) throw schemaError("DIMENSION", "gml:posList");
  if (!["xy", "yx"].includes(axisOrder)) throw schemaError("AXIS_ORDER", "gml:posList");
  const values = String(text).trim().split(/\s+/).map(Number);
  if (!values.length || values.length % 2 || values.some(value => !Number.isFinite(value))) {
    throw schemaError("POS_LIST", "gml:posList");
  }
  const pairs = [];
  for (let index = 0; index < values.length; index += 2) {
    pairs.push(axisOrder === "xy" ? [values[index], values[index + 1]]
      : [values[index + 1], values[index]]);
  }
  return pairs;
}

export function parseGmlFeatureCollection(xml, schema) {
  assertSourceSchema(schema);
  const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false,
    attributeNamePrefix: "@_", removeNSPrefix: false, trimValues: true }).parse(xml);
  const members = findElements(tree, ["gml:member", "wfs:member"]);
  return members.map((member, index) => parseFeatureMember(member, schema, index));
}
```

`parseFeatureMember` wymaga dokładnie typu z `schema.featureType`, wszystkich jawnie skonfigurowanych właściwości i jednej geometrii; dodatkowe skalarne metadane źródła ignoruje. `parseGmlGeometry` obsługuje wyłącznie `gml:Polygon`, `gml:MultiSurface`/`gml:surfaceMember` oraz `gml:MultiPolygon`/`gml:polygonMember`; czyta `gml:exterior`, wszystkie `gml:interior`, `gml:LinearRing` i `gml:posList`. Bierze `srsName` z geometrii albo dziedziczy z bounded member, normalizuje trzy formy URI EPSG przez `SUPPORTED_SRS`, wymaga zgodności z `schema.sourceCrs`, respektuje `srsDimension="2"` i zawsze normalizuje osie do `[x,y]` zgodnie z obowiązkowym `schema.axisOrder`. Brak wymaganej właściwości, dodatkowy typ geometrii, nieznany CRS, niespójny namespace geometrii lub niezamknięty pierścień rzuca `UnsupportedGmlSchemaError` z kodem i ścieżką XML.

```js
// scripts/data/geometry.mjs
proj4.defs("EPSG:2180", "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs");

export function projectGeometry(geometry, {
  sourceCrs, axisOrder = "xy", targetCrs = "EPSG:2180"
}) {
  if (axisOrder !== "xy") throw new TypeError("projectGeometry oczekuje osi znormalizowanych do xy");
  return mapCoordinates(geometry, coordinate =>
    proj4(sourceCrs, targetCrs, coordinate));
}

export function repairGeometry(geometry) {
  const fixed = GeometryFixer.fix(new GeoJSONReader().read(geometry));
  if (!fixed.isValid()) throw new Error("JSTS nie naprawił geometrii");
  return normalizeRingOrientation(new GeoJSONWriter().write(fixed));
}

export function simplifyCity(feature, initialTolerance = 50) {
  const repaired = repairGeometry(feature.geometry);
  const areaM2 = area(repaired);
  const pivot = centroid(repaired);
  const parts = countParts(repaired);
  for (let tolerance = initialTolerance; tolerance >= 0.78125; tolerance /= 2) {
    const geometry = topologyPreservingSimplify(repaired, tolerance);
    if (isValid(geometry) && countParts(geometry) === parts &&
        Math.abs(area(geometry) - areaM2) / areaM2 <= 0.01) {
      return { ...feature, geometry, properties: { ...feature.properties, areaM2, pivot },
        simplificationToleranceM: tolerance, isValid: true };
    }
  }
  throw new Error(`Nie można bezpiecznie uprościć miasta ${feature.properties.cityId}`);
}
```

Kolejność orkiestracji jest stała: parse GML → normalizacja osi → reprojekcja proj4 do EPSG:2180 → JSTS `GeometryFixer` i orientacja ringów → TERYT join → obliczenie nieuproszczonej powierzchni/pivotu → upraszczanie. Linie `OT_SWRS_L` Wisły są parsowane jako osobny wspierany `LineString` tylko w adapterze kontekstowym `parseBdotLineStrings`; adapter akceptuje `gml:LineString` oraz `gml:Curve/gml:segments/gml:LineStringSegment/gml:posList`, scala segmenty mające wspólny koniec i odrzuca inne segmenty krzywych kodem `GEOMETRY_TYPE`. `GeoJSONGeometry` miast pozostaje ściśle Polygon/MultiPolygon. Etykiety w `data/labels.config.json` mają `{id,text,kind,coordinate:[x,y]}` w EPSG:2180.

- [ ] **Step 5: Uruchom GREEN i zweryfikuj na lokalnym Node**

Run: `npx vitest run tests/data/gml.test.js tests/data/geometry.test.js`

Expected: PASS dla `gml:posList`, rozpoznawania `srsName`, osi xy/yx, znanego punktu Warszawy, Polygon, MultiPolygon, TERYT joinu, naprawy orientacji/topologii i adaptacyjnych 50→25 m; przypadki nieobsługiwanego schematu zwracają oczekiwane typed errors.

Run: `node --version`

Expected: wersja spełnia `>=22.18.0 <23`; na maszynie referencyjnej `v22.18.0`.

Run: `npx vitest run tests/data`

Expected: PASS bez procesów zewnętrznych; preprocessing korzysta wyłącznie z modułów z `package-lock.json`.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json scripts/data/gml.mjs scripts/data/geometry.mjs data/labels.config.json tests/data
git commit -m "feat: preprocess official map geometries"
```

### Task 4: Build, validate and reproduce the local snapshot

**Files:**
- Modify: `scripts/data/stable-json.mjs`
- Create: `scripts/data/build-snapshot.mjs`
- Create: `scripts/data/validate.mjs`
- Create: `scripts/data/reproduce.mjs`
- Create: `public/data/manifest.json`
- Create: `public/data/cities.geojson`
- Create: `public/data/poland.geojson`
- Create: `public/data/voivodeships.geojson`
- Create: `public/data/vistula.geojson`
- Create: `public/data/labels.json`
- Create: `public/data/validation-report.json`
- Create: `data/fixtures/invalid-snapshot/manifest.json`
- Create: `data/fixtures/invalid-snapshot/cities.geojson`
- Create: `data/fixtures/invalid-snapshot/validation-report.json`
- Test: `tests/data/validate.test.js`
- Test: `tests/data/reproduce.test.js`

**Interfaces:**
- Consumes: `sources.lock.json`, ranking i przetworzone geometrie z Tasks 2–3.
- Produces: `buildSnapshot({rawDir,outDir,now}): Promise<DataManifest>`, `validateSnapshot(directory): Promise<ValidationReport>`, `reproduceSnapshot(): Promise<{matching:boolean,checksums:Record<string,string>}>`; `DataManifest.schemaVersion === 1`, `projection === "EPSG:2180"`, `cityCount === 30`.

- [ ] **Step 1: Napisz czerwony test pełnej walidacji i odtwarzalności**

```js
// tests/data/validate.test.js
it("rejects every specified snapshot invariant with a non-zero result", async () => {
  const report = await validateSnapshot("data/fixtures/invalid-snapshot");
  expect(report.ok).toBe(false);
  expect(report.failures.map(({ rule }) => rule)).toEqual(expect.arrayContaining([
    "ranking-1-through-30", "unique-teryt", "one-feature-per-teryt", "population-order",
    "geometry-type", "geometry-valid", "epsg2180-range", "parts-preserved",
    "area-delta-at-most-1-percent", "finite-pivot", "source-checksums",
    "output-checksums", "source-attribution-and-dates", "stable-city-ids"
  ]));
});
```

```js
// tests/data/reproduce.test.js
it("emits byte-identical JSON in two clean output directories", async () => {
  const result = await reproduceSnapshot({ now: "2026-09-03T00:00:00.000Z" });
  expect(result.matching).toBe(true);
  expect(Object.keys(result.checksums).sort()).toEqual([
    "cities.geojson", "labels.json", "manifest.json", "poland.geojson",
    "validation-report.json", "vistula.geojson", "voivodeships.geojson"
  ]);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/data/validate.test.js tests/data/reproduce.test.js`

Expected: FAIL z brakiem `validateSnapshot` i `reproduceSnapshot`.

- [ ] **Step 3: Zaimplementuj deterministyczny build i pełny validator**

```js
// scripts/data/stable-json.mjs
export function stableStringify(value) {
  const normalize = item => Array.isArray(item) ? item.map(normalize) :
    item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
      : item;
  return `${JSON.stringify(normalize(value))}\n`;
}
```

`build-snapshot.mjs` wywołuje `parseGmlFeatureCollection` dla trzech artefaktów PRG, `parseBdotLineStrings` dla Wisły, `projectGeometry` dla każdej geometrii, a następnie `repairGeometry`, `selectRankedCities`, `simplifyCity` lub `simplifyContext`; nie uruchamia procesu potomnego. Sortuje miasta po `rank`, pozostałe cechy po stabilnym `id`, zaokrągla współrzędne EPSG:2180 do 3 miejsc po przecinku, zapisuje w `cities.geojson` tylko pola runtime `cityId,name,rank,population,areaM2,pivot` i geometrię, oblicza SHA-256 pięciu danych runtime i buduje manifest z instytucją, zbiorem, landing page, efektywnym URL-em, datami, nazwą pliku, SHA-256, licencją, atrybucją, `preprocessorVersion: 1`, listą 30 miast, reprojekcją i tolerancjami. Liczby części, tolerancja wybrana per miasto i różnica powierzchni trafiają do `validation-report.json`, a nie do runtime properties. Manifest nie hashuje samego siebie ani raportu, aby uniknąć cyklu; raport zapisuje osobny `manifestSha256`, a finalny audit liczy go ponownie.

```js
// scripts/data/validate.mjs
export async function validateSnapshot(directory) {
  const snapshot = await readSnapshot(directory);
  const checks = [
    checkRanks(snapshot), checkUniqueTeryt(snapshot), checkFeatureJoin(snapshot),
    checkPopulation(snapshot), checkGeometries(snapshot), checkCoordinateRange(snapshot),
    checkSimplification(snapshot), checkPivots(snapshot), checkChecksums(snapshot),
    checkProvenance(snapshot), checkStableIds(snapshot)
  ].flat();
  return { ok: checks.every(check => check.ok), cityCount: snapshot.cities.length,
    maxAreaDelta: Math.max(...snapshot.report.cities.map(city => city.areaDelta)),
    checks, failures: checks.filter(check => !check.ok) };
}
```

CLI `validate.mjs` zapisuje raport i ustawia `process.exitCode = 1`, jeśli `ok === false`. `reproduce.mjs` tworzy dwa katalogi przez `mkdtemp`, uruchamia build z tą samą datą locka i porównuje bajty wszystkich wyników.

- [ ] **Step 4: Uruchom GREEN, zbuduj i sprawdź snapshot**

Run: `npm run data:build`

Expected: exit 0 i siedem plików w `public/data`.

Run: `npm run data:validate`

Expected: exit 0; raport podaje `cityCount: 30`, `uniqueTeryt: 30`, `invalidGeometries: 0`, `maxAreaDelta <= 0.01`.

Run: `npm run data:repro`

Expected: exit 0, `matching: true` i identyczne SHA-256 obu czystych buildów.

- [ ] **Step 5: Refactor i verification**

Run: `npx vitest run tests/data`

Expected: PASS dla wejść poprawnych i osobnych naruszeń każdej reguły; zmiana kolejności wejścia nie zmienia bajtów wynikowych.

- [ ] **Step 6: Commit**

```powershell
git add scripts/data public/data tests/data
git commit -m "feat: publish validated local data snapshot"
```

### Task 5: Pure geometry transformation engine

**Files:**
- Create: `src/domain/geometry.js`
- Test: `tests/domain/geometry.test.js`

**Interfaces:**
- Consumes: `GeoJSONGeometry`, `OverlayState`.
- Produces: `transformPoint(point,pivot,translation,angle): Coordinate2180`, `inverseTransformPoint(point,overlay): Coordinate2180`, `transformGeometry(source,overlay): GeoJSONGeometry`, `getDisplayPivot(overlay): Coordinate2180`, `planarArea(geometry): number`.

- [ ] **Step 1: Napisz komplet czerwonych testów transformacji**

```js
// tests/domain/geometry.test.js
it.each([
  [0, [11, 20]], [Math.PI / 2, [10, 21]], [-Math.PI / 2, [10, 19]], [2 * Math.PI, [11, 20]]
])("rotates a point around a fixed pivot", (angle, expected) => {
  expectPointClose(transformPoint([11, 20], [10, 20], [0, 0], angle), expected, 1e-12);
});

it.each([polygonFixture(), multiPolygonFixture()])("preserves area and reverses every point", geometry => {
  const overlay = { overlayId: "o1", cityId: "146501", pivot: [10, 20], translation: [500, -200], angle: 1.2 };
  const transformed = transformGeometry(geometry, overlay);
  expect(relativeDelta(planarArea(geometry), planarArea(transformed))).toBeLessThanOrEqual(1e-9);
  forEachPoint(transformed, point =>
    expectPointClose(inverseTransformPoint(point, overlay), correspondingSourcePoint(point), 1e-7));
});

it("has no cumulative drift because every render starts from source geometry", () => {
  const source = polygonFixture();
  let overlay = baseOverlay();
  for (let index = 0; index < 100; index += 1) overlay = nextAlternatingTransform(overlay);
  expect(transformGeometry(source, overlay)).toEqual(transformGeometry(polygonFixture(), overlay));
  expect(overlay.pivot).toEqual(baseOverlay().pivot);
  expect(getDisplayPivot(overlay)).toEqual([
    overlay.pivot[0] + overlay.translation[0], overlay.pivot[1] + overlay.translation[1]
  ]);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/domain/geometry.test.js`

Expected: FAIL z brakiem `src/domain/geometry.js`.

- [ ] **Step 3: Zaimplementuj minimalne czyste funkcje**

```js
export function transformPoint([x, y], [px, py], [dx, dy], angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos * (x - px) - sin * (y - py) + px + dx,
    sin * (x - px) + cos * (y - py) + py + dy];
}

export function transformGeometry(source, overlay) {
  return mapGeometryCoordinates(source, point =>
    transformPoint(point, overlay.pivot, overlay.translation, overlay.angle));
}

export const getDisplayPivot = ({ pivot, translation }) =>
  [pivot[0] + translation[0], pivot[1] + translation[1]];
```

`mapGeometryCoordinates` obsługuje wyłącznie Polygon i MultiPolygon, zwraca nowe tablice i rzuca `GeometryTransformError` dla innego typu lub wartości niefinitywnej. Odwrotność odejmuje translation i obraca o `-angle`.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/domain/geometry.test.js`

Expected: PASS dla 0°, 90°, −90°, 360°, Polygon, MultiPolygon, tolerancji powierzchni `1e-9` i odwrotności `1e-7 m`.

- [ ] **Step 5: Refactor i verification**

```js
it("does not mutate source geometry or the fixed pivot", () => {
  const source = polygonFixture();
  const overlay = baseOverlay();
  const sourceBefore = structuredClone(source);
  const overlayBefore = structuredClone(overlay);
  transformGeometry(source, overlay);
  expect(source).toEqual(sourceBefore);
  expect(overlay).toEqual(overlayBefore);
});
```

Run: `npx vitest run tests/domain/geometry.test.js`

Expected: PASS bez mutacji i dryfu po 100 zmianach.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/geometry.js tests/domain/geometry.test.js
git commit -m "feat: add drift-free geometry engine"
```

### Task 6: Immutable session reducer and store

**Files:**
- Create: `src/domain/state.js`
- Create: `src/domain/store.js`
- Test: `tests/domain/state.test.js`
- Test: `tests/domain/store.test.js`

**Interfaces:**
- Consumes: `OverlayState`, `ViewState`.
- Produces: `createInitialState({view,viewportMode}): SessionState`, `sessionReducer(state,action): SessionState`, `createStore(reducer,initialState): {getState,dispatch,subscribe}`.
- `SessionState = {overlaysById:Record<string,OverlayState>,overlayOrder:string[],selectedCityId:string|null,selectedOverlayId:string|null,searchQuery:string,desktopPanel:"open"|"collapsed",mobilePanel:"collapsed"|"half"|"full",viewportMode:"desktop"|"mobile",initialView:ViewState,currentView:ViewState,deleteConfirmationOverlayId:string|null}`. Akcja `SET_VIEWPORT_MODE` przyjmuje wyłącznie `"desktop"|"mobile"` i nie niszczy zapamiętanego stanu drugiego panelu.

- [ ] **Step 1: Napisz czerwone testy reduktora**

```js
it("creates multiple copies of one city and updates only the addressed copy", () => {
  let state = createInitialState({ view, viewportMode: "desktop" });
  state = sessionReducer(state, { type: "CREATE_OVERLAY", overlay: overlay("a") });
  state = sessionReducer(state, { type: "CREATE_OVERLAY", overlay: overlay("b") });
  state = sessionReducer(state, { type: "MOVE_OVERLAY", overlayId: "a", translation: [10, 20] });
  state = sessionReducer(state, { type: "ROTATE_OVERLAY", overlayId: "b", angle: Math.PI / 2 });
  expect(state.overlayOrder).toEqual(["a", "b"]);
  expect(state.overlaysById.a.translation).toEqual([10, 20]);
  expect(state.overlaysById.b.translation).toEqual([0, 0]);
  expect(state.overlaysById.b.pivot).toEqual(overlay("b").pivot);
});

it("atomically resets every session field without mutating the previous state", () => {
  const dirty = fullyModifiedState();
  const before = structuredClone(dirty);
  const reset = sessionReducer(dirty, { type: "RESET_SESSION" });
  expect(dirty).toEqual(before);
  expect(reset).toEqual(createInitialState({ view: dirty.initialView, viewportMode: dirty.viewportMode }));
});
```

```js
it("keeps city and overlay selections mutually exclusive", () => {
  const city = sessionReducer(initial, { type: "SELECT_CITY", cityId: "146501" });
  expect(city).toMatchObject({ selectedCityId: "146501", selectedOverlayId: null });
  const overlaySelected = sessionReducer(withOverlay(city, overlay("a")),
    { type: "SELECT_OVERLAY", overlayId: "a" });
  expect(overlaySelected).toMatchObject({ selectedCityId: null, selectedOverlayId: "a" });
});

it("rejects deleting an original and restores an overlay transform", () => {
  expect(sessionReducer(initial, { type: "DELETE_OVERLAY", overlayId: null })).toBe(initial);
  const moved = stateWithOverlay({ translation: [10, 20], angle: 1 });
  const restored = sessionReducer(moved, { type: "RESTORE_OVERLAY_TRANSFORM",
    overlayId: "a", translation: [0, 0], angle: 0 });
  expect(restored.overlaysById.a).toMatchObject({ translation: [0, 0], angle: 0 });
});

it("updates search, panel, view and delete confirmation explicitly", () => {
  const searched = sessionReducer(initial, { type: "SET_SEARCH", query: "lodz" });
  const paneled = sessionReducer(searched, { type: "SET_PANEL", mode: "mobile", value: "half" });
  const mobile = sessionReducer(paneled, { type: "SET_VIEWPORT_MODE", viewportMode: "mobile" });
  const viewed = sessionReducer(mobile, { type: "SET_VIEW", view: nextView });
  const requested = sessionReducer(viewed, { type: "REQUEST_DELETE", overlayId: "a" });
  const cancelled = sessionReducer(requested, { type: "CANCEL_DELETE" });
  expect(cancelled).toMatchObject({ searchQuery: "lodz", mobilePanel: "half", viewportMode: "mobile",
    currentView: nextView, deleteConfirmationOverlayId: null });
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/domain/state.test.js tests/domain/store.test.js`

Expected: FAIL z brakiem `src/domain/state.js`.

- [ ] **Step 3: Zaimplementuj reducer i store**

```js
export function sessionReducer(state, action) {
  switch (action.type) {
    case "CREATE_OVERLAY":
      if (state.overlaysById[action.overlay.overlayId]) return state;
      return { ...state, overlaysById: { ...state.overlaysById,
        [action.overlay.overlayId]: action.overlay },
        overlayOrder: [...state.overlayOrder, action.overlay.overlayId],
        selectedCityId: null, selectedOverlayId: action.overlay.overlayId };
    case "MOVE_OVERLAY":
      return updateOverlay(state, action.overlayId, overlay =>
        ({ ...overlay, translation: [...action.translation] }));
    case "RESTORE_OVERLAY_TRANSFORM":
      return updateOverlay(state, action.overlayId, overlay => ({ ...overlay,
        translation: [...action.translation], angle: action.angle }));
    case "RESET_SESSION":
      return createInitialState({ view: state.initialView, viewportMode: state.viewportMode });
    default:
      return state;
  }
}
```

`ROTATE_OVERLAY` podmienia tylko `angle`; `SELECT_CITY` ustawia `selectedCityId` i zeruje `selectedOverlayId`; `SELECT_OVERLAY` robi odwrotnie; `CLEAR_SELECTION` zeruje oba; `DELETE_OVERLAY` usuwa klucz i identyfikator z kolejności oraz czyści selekcję/potwierdzenie tej kopii; `SET_SEARCH`, `SET_VIEW`, `SET_VIEWPORT_MODE`, `REQUEST_DELETE` i `CANCEL_DELETE` podmieniają wyłącznie nazwane pola. `SET_PANEL` akceptuje tylko `open|collapsed` dla desktop i `collapsed|half|full` dla mobile. Store powiadamia subskrybentów tylko po zmianie referencji stanu; jeśli reducer lub walidator akcji rzuci, stan i subskrypcje pozostają niezmienione.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/domain/state.test.js tests/domain/store.test.js`

Expected: PASS dla wielu kopii, selekcji, usuwania, niemutowalności i atomowego Resetu.

- [ ] **Step 5: Refactor i verification**

Zamroź fixture przez `Object.freeze`, wyślij wszystkie akcje i potwierdź brak `TypeError` mutacji. Run: `npx vitest run tests/domain`

Expected: PASS; pivot żadnej kopii nie zmienia się przy MOVE/ROTATE.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/state.js src/domain/store.js tests/domain
git commit -m "feat: model immutable comparison sessions"
```

### Task 7: Versioned data repository and failure classification

**Files:**
- Create: `src/data/repository.js`
- Test: `tests/data/repository.test.js`

**Interfaces:**
- Consumes: `fetchImpl(url,{cache:"no-store"})`, `public/data/manifest.json` i lokalne GeoJSON.
- Produces: `loadData(fetchImpl=fetch): Promise<DataBundle>`, `readGeoJSONFeatures(geojson): import("ol/Feature").default[]`, `getCity(cityId): CityFeature`, `CriticalDataError(code,message,cause)`, `ContextLayerWarning(layer,message)`; `DataBundle = {manifest,cities,citiesById,context:{poland,voivodeships,vistula,labels},warnings}`.

- [ ] **Step 1: Napisz czerwone testy ready, critical i degraded**

```js
it("loads exactly 30 cities and parses GeoJSON explicitly as EPSG:2180", async () => {
  const bundle = await loadData(fetchFixtureSet());
  expect(bundle.cities).toHaveLength(30);
  expect(bundle.citiesById.get(bundle.cities[0].properties.cityId)).toBe(bundle.cities[0]);
  expect(geoJSONReadOptions).toEqual({ dataProjection: "EPSG:2180", featureProjection: "EPSG:2180" });
});

it.each([
  ["missing manifest", missing("manifest.json"), "MANIFEST_MISSING"],
  ["wrong version", wrongVersion(), "DATA_VERSION_UNSUPPORTED"],
  ["missing cities", missing("cities.geojson"), "CITIES_MISSING"],
  ["wrong projection", wrongProjection(), "PROJECTION_INVALID"],
  ["29 cities", cityCount(29), "CITY_COUNT_INVALID"]
])("classifies %s as critical", async (_name, fetchImpl, code) => {
  await expect(loadData(fetchImpl)).rejects.toMatchObject({ name: "CriticalDataError", code });
});

it("keeps cities usable and names a missing context layer", async () => {
  const bundle = await loadData(missing("vistula.geojson"));
  expect(bundle.cities).toHaveLength(30);
  expect(bundle.warnings).toEqual([{ layer: "vistula", message: "Nie udało się wczytać warstwy: Wisła." }]);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/data/repository.test.js`

Expected: FAIL z brakiem `src/data/repository.js`.

- [ ] **Step 3: Zaimplementuj repository**

```js
export async function loadData(fetchImpl = fetch) {
  const manifest = await requiredJson("/data/manifest.json", "MANIFEST_MISSING", fetchImpl);
  assertManifest(manifest);
  const cities = await requiredGeoJSON("/data/cities.geojson", "CITIES_MISSING", fetchImpl);
  if (cities.features.length !== 30) throw new CriticalDataError("CITY_COUNT_INVALID", "Dane nie zawierają 30 miast.");
  const { context, warnings } = await loadOptionalContext(fetchImpl);
  return { manifest, cities: cities.features,
    citiesById: new Map(cities.features.map(city => [city.properties.cityId, city])),
    context, warnings };
}
```

`readGeoJSONFeatures` tworzy `new GeoJSON().readFeatures(json, {dataProjection:"EPSG:2180",featureProjection:"EPSG:2180"})`; repository zachowuje także surowe GeoJSON dla silnika domenowego. Retry zawsze ponownie wywołuje `loadData` z `cache: "no-store"`.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/data/repository.test.js`

Expected: PASS dla dokładnie 30 miast, pięciu krytycznych klas błędu i degradacji każdej pojedynczej warstwy kontekstowej.

- [ ] **Step 5: Refactor i verification**

```js
it("indexes complete runtime metadata by unique cityId", async () => {
  const bundle = await loadData(fetchFixtureSet());
  expect(new Set(bundle.cities.map(city => city.properties.cityId)).size).toBe(30);
  for (const city of bundle.cities) {
    expect(city.properties.areaM2).toBeGreaterThan(0);
    expect(city.properties.pivot).toHaveLength(2);
    expect(city.properties.pivot.every(Number.isFinite)).toBe(true);
  }
});
```

Run: `npx vitest run tests/data/repository.test.js`

Expected: PASS; żadna ścieżka runtime nie zawiera obcego originu.

- [ ] **Step 6: Commit**

```powershell
git add src/data/repository.js tests/data/repository.test.js
git commit -m "feat: load versioned local map data"
```

### Task 8: OpenLayers map, atlas layers and state projection

**Files:**
- Create: `src/map/create-map.js`
- Create: `src/map/layers.js`
- Create: `src/map/sync-overlays.js`
- Create: `src/map/navigation.js`
- Test: `tests/map/layers.test.js`
- Test: `tests/map/sync-overlays.test.js`
- Test: `tests/map/navigation.test.js`

**Interfaces:**
- Consumes: `DataBundle`, `SessionState`, `transformGeometry`.
- Produces: `createMapScene({target,data,onViewChange}): MapScene`, `createAtlasLayers(data): LayerSet`, `syncOverlays({state,citiesById,overlaySource,handleSource,labelSource}): void`, `fitSelection(map,extent,panelMetrics,reducedMotion): void`, `resetView(map,initialView): void`.
- `LayerSet = {context,originals,overlays,handles,labels}` z osobnymi `VectorSource`.

- [ ] **Step 1: Napisz czerwone testy źródeł, stylu i synchronizacji**

```js
it("keeps immutable originals in a source separate from overlays", () => {
  const layers = createAtlasLayers(dataBundle());
  expect(layers.originals.getSource().getFeatures()).toHaveLength(30);
  expect(layers.overlays.getSource().getFeatures()).toHaveLength(0);
});

it("rebuilds one overlay, label and handle from state without changing the original", () => {
  const originalBefore = originalFeature().getGeometry().clone();
  syncOverlays({ state: stateWithOverlay(), citiesById, ...sources });
  expect(sources.overlays.getFeatures()).toHaveLength(1);
  expect(sources.handles.getFeatures()[0].getGeometry().getCoordinates()).toEqual(getDisplayPivot(overlay));
  expect(originalFeature().getGeometry().getCoordinates()).toEqual(originalBefore.getCoordinates());
});

it("uses deterministic city colors and non-color selection cues", () => {
  expect(cityColor("146501")).toBe(cityColor("146501"));
  expect(styleFor(selectedOverlay())).toMatchObject({ strokeWidth: 3, hasContrastHalo: true, kind: "overlay" });
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/map`

Expected: FAIL z brakiem `src/map/layers.js`.

- [ ] **Step 3: Zaimplementuj minimalną scenę i warstwy**

```js
export function syncOverlays({ state, citiesById, overlaySource, handleSource, labelSource }) {
  overlaySource.clear(true);
  handleSource.clear(true);
  labelSource.getFeatures()
    .filter(feature => feature.get("kind") === "overlay")
    .forEach(feature => labelSource.removeFeature(feature));
  for (const overlayId of state.overlayOrder) {
    const overlay = state.overlaysById[overlayId];
    const city = citiesById.get(overlay.cityId);
    overlaySource.addFeature(toOlFeature(transformGeometry(city.geometry, overlay), { overlayId, cityId: overlay.cityId }));
    handleSource.addFeature(pointFeature(getDisplayPivot(overlay), { overlayId, role: "rotation-handle" }));
    labelSource.addFeature(pointFeature(getDisplayPivot(overlay), { overlayId, text: city.properties.name, kind: "overlay" }));
  }
}
```

`createMapScene` używa `Map`, Canvas 2D `VectorLayer`, `View({projection:"EPSG:2180"})`, lokalnych źródeł i standardowego pan/zoom/pinch. Styl: papierowe tło, wyraźna Polska, subtelne województwa, Wisła, półprzezroczyste oryginały, mocniejszy kontur kopii, halo selekcji i label z offsetem od uchwytu. `labelSource` od początku zawiera etykiety kontekstowe i etykiety 30 oryginalnych miast w ich pivotach; sync wymienia wyłącznie cechy z `kind:"overlay"`, aby nie usuwać etykiet stałych. `fitSelection` oblicza padding z panelu/arkusza i ogranicza geometrię do 60% dostępnego prostokąta.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/map`

Expected: PASS; 30 oryginałów, niezależne źródła, zgodny pivot/label/handle i niemutowalna geometria miasta.

- [ ] **Step 5: Refactor i verification**

```js
it("reprojects MOVE/ROTATE state and removes only derived features on Reset", () => {
  syncOverlays({ state: movedAndRotatedState(), citiesById, ...sources });
  expect(sources.overlays.getFeatures()[0].get("translation")).toBeUndefined();
  expect(sources.overlays.getFeatures()[0].get("angle")).toBeUndefined();
  syncOverlays({ state: initialState(), citiesById, ...sources });
  expect(sources.overlays.getFeatures()).toHaveLength(0);
  expect(sources.handles.getFeatures()).toHaveLength(0);
  expect(sources.originals.getFeatures()).toHaveLength(30);
});
```

Run: `npx vitest run tests/map`

Expected: PASS; RESET usuwa overlay, handle i overlay label jednym syncem, ale nie oryginały.

- [ ] **Step 6: Commit**

```powershell
git add src/map tests/map
git commit -m "feat: render local atlas and city layers"
```

### Task 9: Pointer interactions, rotation and map navigation priority

**Files:**
- Create: `src/map/interactions.js`
- Test: `tests/map/interactions.test.js`

**Interfaces:**
- Consumes: `map`, `dispatch`, `getState`, `citiesById`, `idFactory`, `pixelToCoordinate`.
- Produces: `createComparisonInteractions(options): {handlePointerDown,handlePointerMove,handlePointerUp,cancel,destroy}`; akcje `CREATE_OVERLAY`, `MOVE_OVERLAY`, `ROTATE_OVERLAY`, `RESTORE_OVERLAY_TRANSFORM`, `SELECT_CITY`, `SELECT_OVERLAY`.

- [ ] **Step 1: Napisz czerwone testy gestów i priorytetów**

```js
it("clicks an original but creates a selected copy only after 6 pixels", () => {
  const controller = harness({ hit: originalHit("146501"), idFactory: () => "overlay-1" });
  controller.down([100, 100]); controller.move([104, 103]); controller.up([104, 103]);
  expect(dispatch).toHaveBeenCalledWith({ type: "SELECT_CITY", cityId: "146501" });
  controller.down([100, 100]); controller.move([107, 100]);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "CREATE_OVERLAY", overlay: expect.objectContaining({ overlayId: "overlay-1", cityId: "146501" })
  }));
});

it("moves an existing overlay without creating another and gives it priority over pan", () => {
  const controller = harness({ hit: overlayHit("overlay-1") });
  controller.drag([100, 100], [130, 120]);
  expect(dispatch).toHaveBeenCalledWith({ type: "MOVE_OVERLAY", overlayId: "overlay-1", translation: [30, 20] });
  expect(mapPan).not.toHaveBeenCalled();
});

it("leaves empty-space dragging to OpenLayers pan and Escape cancels a gesture", () => {
  harness({ hit: null }).drag([0, 0], [20, 20]);
  expect(mapPan).toHaveBeenCalled();
  expect(cancelledDragState()).toEqual(stateBeforeDrag());
});

it("computes handle rotation with atan2 and preserves the fixed pivot", () => {
  const controller = harness({ hit: rotationHandleHit("overlay-1") });
  controller.drag([110, 100], [100, 110]);
  expect(dispatch).toHaveBeenCalledWith({ type: "ROTATE_OVERLAY",
    overlayId: "overlay-1", angle: Math.PI / 2 });
  expect(getState().overlaysById["overlay-1"].pivot).toEqual(originalPivot);
});

it("supports repeated original drags and touch pointers", () => {
  const controller = harness({ hit: originalHit("066301"),
    idFactory: sequentialIds("overlay-1", "overlay-2") });
  controller.touchDrag([100, 100], [107, 100]);
  controller.touchDrag([100, 100], [108, 100]);
  expect(createdOverlayIds(dispatch)).toEqual(["overlay-1", "overlay-2"]);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/map/interactions.test.js`

Expected: FAIL z brakiem `src/map/interactions.js`.

- [ ] **Step 3: Zaimplementuj maszynę gestu**

```js
const DRAG_THRESHOLD_PX = 6;

function beginOriginalDrag(hit, pixel) {
  gesture = { kind: "pending-original", cityId: hit.cityId, startPixel: pixel,
    startCoordinate: pixelToCoordinate(pixel) };
}

function updatePendingOriginal(pixel) {
  if (pixelDistance(gesture.startPixel, pixel) < DRAG_THRESHOLD_PX) return;
  const city = citiesById.get(gesture.cityId);
  const overlay = { overlayId: idFactory(), cityId: gesture.cityId,
    translation: coordinateDelta(gesture.startCoordinate, pixelToCoordinate(pixel)),
    angle: 0, pivot: [...city.properties.pivot] };
  dispatch({ type: "CREATE_OVERLAY", overlay });
  gesture = { kind: "overlay-drag", overlayId: overlay.overlayId,
    startCoordinate: gesture.startCoordinate, initialTranslation: [0, 0] };
}
```

Hit order to handle, overlay, original, empty. Controller zatrzymuje map pan tylko dla pierwszych trzech. Przy rozpoczęciu MOVE/ROTATE zapisuje `{translation,angle}`; `cancel()` wysyła `RESTORE_OVERLAY_TRANSFORM` z tym snapshotem i nie usuwa wcześniej zatwierdzonych kopii. Anulowanie pending-original przed progiem nie tworzy akcji.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/map/interactions.test.js`

Expected: PASS dla progu 6 px, drag oryginału/kopii, uchwytu, touch, pan pustego obszaru i Escape.

- [ ] **Step 5: Refactor i verification**

Run: `npx vitest run tests/domain/geometry.test.js tests/map/interactions.test.js tests/map/sync-overlays.test.js`

Expected: PASS; obrót gestem aktualizuje wyłącznie `angle`, a powierzchnia pozostaje w tolerancji `1e-9`.

- [ ] **Step 6: Commit**

```powershell
git add src/map/interactions.js tests/map/interactions.test.js
git commit -m "feat: compare cities with pointer gestures"
```

### Task 10: Desktop panel, search, selection actions and keyboard

**Files:**
- Modify: `index.html`
- Create: `src/ui/panel.js`
- Create: `src/ui/keyboard.js`
- Create: `src/ui/announcer.js`
- Modify: `src/styles.css`
- Test: `tests/ui/panel.test.js`
- Test: `tests/ui/keyboard.test.js`

**Interfaces:**
- Consumes: `DataBundle`, store, `fitSelection`, interaction `cancel`.
- Produces: `createPanel({root,data,store,onCenter,onReset}): PanelController`, `normalizeSearch(text): string`, `bindKeyboard(options): () => void`, `createAnnouncer(element): {announce(message)}`.

- [ ] **Step 1: Napisz czerwone testy widoku desktopowego**

```js
it("renders a semantic ranked list of 30 and accent-insensitive search", () => {
  const panel = renderPanel(dataBundle());
  expect(panel.getAllByRole("listitem")).toHaveLength(30);
  userEvent.type(panel.getByRole("searchbox"), "lodz");
  expect(panel.getByRole("button", { name: /Łódź/ })).toHaveAttribute("aria-current", "false");
  userEvent.clear(panel.getByRole("searchbox"));
  userEvent.type(panel.getByRole("searchbox"), "miasto spoza rankingu");
  expect(panel.getByText("Brak miasta w pierwszej trzydziestce")).toBeVisible();
});

it("runs one confirmation flow for button and Delete", () => {
  selectOverlay("o1");
  pressDelete();
  expect(screen.getByRole("group", { name: "Potwierdź usunięcie kopii" })).toBeVisible();
  pressEnter();
  expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_OVERLAY", overlayId: "o1" });
});

it.each([["]", false, 1], ["[", false, -1], ["]", true, 15], ["[", true, -15]])(
  "rotates selected overlay from the keyboard", (key, shiftKey, degrees) => {
    keydown({ key, shiftKey });
    expect(lastAngleDegrees()).toBe(degrees);
  });
```

```js
it.each(["INPUT", "TEXTAREA", "SELECT", "contenteditable"])("ignores rotation shortcuts while editing %s", tag => {
  focusEditable(tag);
  keydown({ key: "]" });
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ROTATE_OVERLAY" }));
});

it("applies Escape priority: confirmation, gesture, then selection", () => {
  keyboardFor(stateWithDeleteConfirmation()).keydown({ key: "Escape" });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "CANCEL_DELETE" });
  keyboardFor(stateWithActiveGesture()).keydown({ key: "Escape" });
  expect(interactions.cancel).toHaveBeenCalled();
  keyboardFor(stateWithSelection()).keydown({ key: "Escape" });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "CLEAR_SELECTION" });
});

it.each([
  ["created", "Utworzono kopię miasta Lublin."],
  ["deleted", "Usunięto kopię miasta Lublin."],
  ["reset", "Przywrócono początkowy układ mapy."]
])("announces %s operations", (event, message) => {
  announceSessionEvent(event, { cityName: "Lublin" });
  expect(screen.getByRole("status")).toHaveTextContent(message);
});
```

Test slidera wymaga `min="-180"`, `max="180"`, `step="1"` i przeliczenia stopni na radiany; test źródeł wymaga widocznego przycisku „Źródła danych” także przy zwiniętym panelu.

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/ui/panel.test.js tests/ui/keyboard.test.js`

Expected: FAIL z brakiem `src/ui/panel.js`.

- [ ] **Step 3: Zaimplementuj semantyczny panel**

```js
export const normalizeSearch = text => text.normalize("NFD")
  .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pl").trim();

export function renderCityList(list, cities, query, selection) {
  const visible = cities.filter(city =>
    normalizeSearch(city.properties.name).includes(normalizeSearch(query)));
  list.replaceChildren(...visible.map(city => cityListItem(city, selection)));
  list.hidden = visible.length === 0;
  emptyMessage.hidden = visible.length !== 0;
}
```

`index.html` otrzymuje `<aside>`, search label/input, `<ol>`, details, tekstowe przyciski, slider, instrukcję, zawsze dostępny przycisk „Źródła danych”, dialog/panel atrybucji i `<div aria-live="polite" aria-atomic="true">`. Klik listy wysyła `SELECT_CITY` i `onCenter`; suwak zapisuje radiany. `aria-current` lub `aria-selected` wskazuje aktywny element. Oryginał nie pokazuje aktywnej akcji usuwania.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/ui/panel.test.js tests/ui/keyboard.test.js`

Expected: PASS dla listy 30, polskich znaków, empty state, details area, slidera, potwierdzenia i skrótów.

- [ ] **Step 5: Refactor i verification**

Run: `npx vitest run tests/ui`

Expected: PASS; kolejność tabulacji jest logiczna, collapse ma `aria-expanded`, a create/delete/reset wypowiadają trzy dokładne komunikaty z testu.

- [ ] **Step 6: Commit**

```powershell
git add index.html src/ui src/styles.css tests/ui
git commit -m "feat: add accessible city comparison panel"
```

### Task 11: Bootstrap, synchronization and recoverable error flows

**Files:**
- Modify: `src/main.js`
- Create: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `loadData`, `createStore`, `createMapScene`, layer sync, interactions, panel.
- Produces: `startApp({root,fetchImpl,mediaQuery}): Promise<AppController>`, `AppController.retry(): Promise<void>`, `AppController.destroy(): void`.

- [ ] **Step 1: Napisz czerwone testy pełnego spięcia i błędów**

```js
it("projects one store update to overlays, controls, label and angle", async () => {
  const app = await startApp(fixtureDependencies());
  app.store.dispatch({ type: "CREATE_OVERLAY", overlay });
  app.store.dispatch({ type: "ROTATE_OVERLAY", overlayId: overlay.overlayId, angle: Math.PI / 2 });
  expect(app.scene.layers.overlays.getSource().getFeatures()).toHaveLength(1);
  expect(screen.getByRole("slider", { name: "Kąt obrotu" })).toHaveValue("90");
  expect(app.scene.layers.labels.getSource().getFeatures()[0].get("text")).toBe("Lublin");
});

it("blocks the map on critical data errors and retries without page reload", async () => {
  fetchImpl.mockRejectedValueOnce(new CriticalDataError("MANIFEST_MISSING", "Brak manifestu danych."))
    .mockImplementation(fixtureFetch);
  const app = await startApp({ root, fetchImpl });
  expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się wczytać danych mapy.");
  await userEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
  expect(screen.getByRole("application", { name: "Mapa porównawcza miast" })).toBeVisible();
  expect(location.reload).not.toHaveBeenCalled();
});
```

```js
it("shows a named context warning without blocking city comparison", async () => {
  const app = await startApp(degradedFixture("vistula"));
  expect(screen.getByRole("status")).toHaveTextContent("Nie udało się wczytać warstwy: Wisła.");
  expect(app.store.getState().overlaysById).toEqual({});
  expect(screen.getAllByRole("listitem")).toHaveLength(30);
});

it("keeps state unchanged when creating or transforming geometry fails", async () => {
  const app = await startApp(fixtureDependencies({ transformGeometry: () => {
    throw new GeometryTransformError("non-finite coordinate");
  }}));
  const before = structuredClone(app.store.getState());
  await app.actions.createOverlay("146501");
  expect(app.store.getState()).toEqual(before);
  expect(screen.getByRole("status")).toHaveTextContent("Nie udało się utworzyć lub przekształcić kopii.");
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/app.test.js`

Expected: FAIL z brakiem `src/app.js`.

- [ ] **Step 3: Zaimplementuj bootstrap**

```js
export async function startApp({ root, fetchImpl = fetch, mediaQuery = matchMedia }) {
  try {
    const data = await loadData(fetchImpl);
    const store = createStore(sessionReducer, createInitialState(initialOptions(data, mediaQuery)));
    const scene = createMapScene({ target: root.querySelector("#map"), data,
      onViewChange: view => store.dispatch({ type: "SET_VIEW", view }) });
    const panel = createPanel({ root, data, store,
      onCenter: selection => fitSelectionForState(scene.map, selection, store.getState()),
      onReset: () => {
        store.dispatch({ type: "RESET_SESSION" });
        resetView(scene.map, store.getState().initialView);
      } });
    const unsubscribe = store.subscribe(state => {
      syncOverlays({ state, citiesById: data.citiesById, ...scene.sources });
      panel.render(state);
    });
    return createController({ data, store, scene, panel, unsubscribe });
  } catch (error) {
    return renderCriticalError(root, error, () => startApp({ root, fetchImpl, mediaQuery }));
  }
}
```

`src/main.js` uruchamia projekcję i `startApp`. Ostrzeżenia warstw kontekstowych są nieinwazyjne. Błąd create/transform jest przechwytywany przed dispatch, logowany technicznie tylko przy `import.meta.env.DEV`, pokazuje „Nie udało się utworzyć lub przekształcić kopii.” i nie zmienia stanu. Callback media query wysyła `SET_VIEWPORT_MODE`; Reset wysyła jedną domenową akcję, po której adapter mapy stosuje `initialView` bez przeładowania strony.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/app.test.js`

Expected: PASS dla synchronizacji, krytycznego ekranu, retry, degradacji i rollbacku transformacji.

- [ ] **Step 5: Refactor i verification**

Run: `npm test`

Expected: wszystkie testy PASS; `destroy()` usuwa listenery i subskrypcje. Canvas 2D pozostaje rendererem bazowym, brak krytycznej ścieżki WebGL.

- [ ] **Step 6: Commit**

```powershell
git add src/main.js src/app.js src/styles.css tests/app.test.js
git commit -m "feat: integrate map with resilient app bootstrap"
```

### Task 12: Responsive bottom sheet and WCAG behavior

**Files:**
- Create: `src/ui/layout.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Test: `tests/ui/layout.test.js`
- Test: `tests/ui/accessibility.test.js`

**Interfaces:**
- Consumes: `matchMedia("(max-width: 767px)")`, store panel actions, map navigation padding.
- Produces: `createResponsiveLayout({root,map,store,mediaQuery}): LayoutController`, `getMapPadding(state,viewport): [top,right,bottom,left]`, `setMobilePanel(position)`.

- [ ] **Step 1: Napisz czerwone testy trzech pozycji i preferencji użytkownika**

```js
it.each([
  ["collapsed", 44], ["half", Math.round(844 * 0.45)], ["full", Math.round(844 * 0.85)]
])("sets stable mobile sheet position %s and map padding", (position, expectedHeight) => {
  const layout = renderLayout({ width: 390, height: 844 });
  layout.setMobilePanel(position);
  expect(layout.sheet).toHaveAttribute("data-position", position);
  expect(layout.sheetHeight()).toBe(expectedHeight);
  expect(getMapPadding(layout.state, { width: 390, height: 844 })[2]).toBe(expectedHeight);
});

it("disables nonessential animation with reduced motion", () => {
  const layout = renderLayout({ reducedMotion: true });
  expect(layout.mapFitDuration()).toBe(0);
  expect(getComputedStyle(layout.sheet).transitionDuration).toBe("0s");
});
```

```js
it("keeps controls at least 44 by 44 CSS pixels and visible at 200% zoom", () => {
  const layout = renderLayout({ width: 390, height: 844, cssPixelScale: 2 });
  for (const control of layout.interactiveControls()) {
    expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  expect(layout.panel.scrollWidth).toBeLessThanOrEqual(layout.panel.clientWidth);
  expect(layout.actions().every(action => action.isVisible())).toBe(true);
});

it.each([
  ["body text", palette.text, palette.paper, 4.5],
  ["large labels", palette.largeText, palette.paper, 3],
  ["city outline", palette.cityStroke, palette.cityFill, 3],
  ["rotation handle", palette.handle, palette.paper, 3],
  ["focus ring", palette.focus, palette.paper, 3]
])("%s meets its contrast threshold", (_name, foreground, background, minimum) => {
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/ui/layout.test.js tests/ui/accessibility.test.js`

Expected: FAIL z brakiem `src/ui/layout.js`.

- [ ] **Step 3: Zaimplementuj layout i CSS**

```js
export function getMapPadding(state, viewport) {
  if (state.viewportMode === "desktop") {
    return [24, 24, 24, state.desktopPanel === "open" ? 344 : 72];
  }
  const bottom = state.mobilePanel === "full" ? viewport.height * 0.85 :
    state.mobilePanel === "half" ? viewport.height * 0.45 : 44;
  return [16, 16, Math.round(bottom), 16];
}
```

CSS używa media query `max-width: 767px`, stałych pozycji `translateY`, `min-width/min-height:44px`, kontrastów AA, `:focus-visible`, `overflow-x:hidden` i `@media (prefers-reduced-motion: reduce)`. Desktop panel zwija się do wąskiego przycisku; mobile uchwyt jest przyciskiem z tekstem dostępnym i cyklem collapsed → half → full. Pointer drag uchwytu snapuje do najbliższej z trzech pozycji po pointerup; klawiatura i tap wykonują ten sam cykl bez gestu.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/ui/layout.test.js tests/ui/accessibility.test.js`

Expected: PASS dla 390 × 844, breakpointu 767/768, paddingu, touch targets, focus i reduced motion.

- [ ] **Step 5: Refactor i verification**

Run: `npm test`

Expected: PASS; wyśrodkowana geometria mieści się poza panelem/arkuszem, lista/search/delete/center/reset/slider działają w obu layoutach.

- [ ] **Step 6: Commit**

```powershell
git add src/ui/layout.js src/app.js src/styles.css tests/ui
git commit -m "feat: support accessible mobile comparison"
```

### Task 13: Playwright journeys, offline assertion, axe and screenshots

**Files:**
- Create: `playwright.config.js`
- Create: `e2e/helpers/map.js`
- Create: `e2e/desktop.spec.js`
- Create: `e2e/mobile.spec.js`
- Create: `e2e/accessibility.spec.js`
- Create: `e2e/offline.spec.js`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: zbudowane `dist`, selektory `data-testid` będące dodatkiem do nazw dostępności.
- Produces: Playwright projects `chromium-desktop` i `chromium-mobile`; `assertNoForeignRequests(page, origin): Promise<void>`; screenshoty `desktop-lublin-rzeszow.png`, `desktop-two-rotated-overlays.png`, `mobile-centered-overlay.png`.

- [ ] **Step 1: Napisz czerwony E2E dla statycznej aplikacji i sieci**

Run:

```powershell
npm install --save-dev --save-exact @playwright/test@1.62.1 @axe-core/playwright@4.13.0
```

```js
// e2e/offline.spec.js
test("loads local atlas with 30 cities and never requests another origin", async ({ page }) => {
  const foreign = new Set();
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4173") return route.continue();
    foreign.add(url.href);
    return route.abort("internetdisconnected");
  });
  page.on("request", request => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") foreign.add(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("listitem")).toHaveCount(30);
  await expect(page.getByTestId("poland-outline")).toBeVisible();
  expect([...foreign]).toEqual([]);
});
```

```js
// e2e/desktop.spec.js
test("moves Lublin beside Rzeszów while the original remains", async ({ page }) => {
  await selectCity(page, "Lublin");
  const originalExtent = await mapFeatureExtent(page, { city: "Lublin", kind: "original" });
  await dragOriginalToCity(page, "Lublin", "Rzeszów");
  await expect(page.getByTestId("overlay-count")).toHaveText("1");
  expect(await mapFeatureExtent(page, { city: "Lublin", kind: "original" })).toEqual(originalExtent);
  await expect(page.getByTestId("selected-overlay")).toHaveAttribute("data-city", "Lublin");
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx playwright install chromium`

Expected: przeglądarka zostaje zainstalowana.

Run: `npm run build`

Expected: exit 0.

Run: `npx playwright test e2e/offline.spec.js e2e/desktop.spec.js`

Expected: FAIL z brakiem konfiguracji/helperów lub wymaganych test ids.

- [ ] **Step 3: Dodaj pełne journeys i stabilne hooki testowe**

`playwright.config.js` uruchamia `npm run preview -- --host 127.0.0.1`, używa portu 4173, trace przy retry i dwóch viewportów: desktop 1440 × 1000 oraz mobile 390 × 844. `desktop.spec.js` pokrywa: start Polski, Lublin→Rzeszów, obrót uchwytem/suwakiem/klawiaturą ze zgodnością radianów i powierzchni, zoom/pan pustego obszaru, drugą niezależną obróconą kopię, delete confirmation oraz dowód Resetu przed/po. `mobile.spec.js` pokrywa trzy pozycje arkusza, search, touch create/rotate, center bez zasłonięcia i Reset.

```js
// e2e/accessibility.spec.js
for (const state of ["initial", "panel-open", "overlay-selected"]) {
  test(`has no serious or critical axe violations: ${state}`, async ({ page }) => {
    await arrangeState(page, state);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(results.violations.filter(v => ["serious", "critical"].includes(v.impact))).toEqual([]);
  });
}
```

Testy zapisują trzy wymagane screenshoty do `test-results/evidence/`, raport sieci, wynik axe i JSON Resetu. Hooki `data-testid` nie zastępują ról/nazw w interakcjach panelu.

- [ ] **Step 4: Uruchom GREEN**

Run: `npm run build`

Expected: exit 0.

Run: `npm run test:e2e`

Expected: wszystkie desktop/mobile/offline journeys PASS; brak requestów do obcych originów; trzy screenshoty zapisane.

Run: `npm run test:a11y`

Expected: PASS, zero poważnych i krytycznych naruszeń.

- [ ] **Step 5: Refactor i verification**

Uruchom testy dwukrotnie, aby wykryć niestabilność:

Run: `npm run test:e2e`

Expected: PASS bez retry.

Run: `npm run test:e2e`

Expected: PASS bez retry; screenshoty pokazują oryginał Lublina i kopię przy Rzeszowie, dwie obrócone kopie oraz mobilną niezasłoniętą kopię.

- [ ] **Step 6: Commit**

```powershell
git add playwright.config.js e2e .gitignore package.json package-lock.json src
git commit -m "test: verify offline map journeys"
```

### Task 14: README and final completion audit

**Files:**
- Modify: `README.md`
- Create: `docs/evidence/.gitkeep`
- Create during audit, do not commit unless explicitly requested by reviewer: `test-results/evidence/*`

**Interfaces:**
- Consumes: wszystkie skrypty, manifest, raporty, testy i artefakty Tasks 1–13.
- Produces: instrukcję czystego checkoutu, pochodzenie i licencje, procedurę odświeżenia snapshotu, macierz dowodów oraz końcowy raport przekazania.

- [ ] **Step 1: Napisz czerwony test dokumentacji**

```js
// tests/readme.test.js
it("documents every reproducible command and evidence artifact", async () => {
  const readme = await readFile("README.md", "utf8");
  for (const text of [
    "Node.js >=22.18.0 <23", "npm 10.9.3", "npm ci", "npm run data:download",
    "npm run data:build", "npm run data:validate", "npm run data:repro",
    "npm test", "npm run build", "npm run test:e2e", "npm run test:a11y",
    "PRG", "BDOT10k", "GUS", "EPSG:2180", "Źródła danych"
  ]) expect(readme).toContain(text);
});
```

- [ ] **Step 2: Uruchom RED**

Run: `npx vitest run tests/readme.test.js`

Expected: FAIL, ponieważ początkowy README nie opisuje komend ani źródeł.

- [ ] **Step 3: Napisz konkretny README**

README zawiera: wymagania Node `>=22.18.0 <23` i npm 10.9.3, informację „brak zależności systemowych — pipeline danych działa po `npm ci`”, development/build/preview, sekwencję odświeżenia i walidacji danych, źródła PRG `A04_Granice_miast`, GUS stan 2025-12-31, BDOT10k Wisła, kontrakt GML/axis order, TERYT, licencje/atrybucje, architekturę, ograniczenia v1, obsługę panelu i skróty, strategię testów oraz lokalizacje każdego końcowego dowodu.

- [ ] **Step 4: Uruchom GREEN**

Run: `npx vitest run tests/readme.test.js`

Expected: PASS.

- [ ] **Step 5: Wykonaj final completion audit na bieżącym commicie**

Run: `node --version`

Expected: wersja spełnia `>=22.18.0 <23`; na maszynie referencyjnej `v22.18.0`.

Run: `npm --version`

Expected: `10.9.3`.

Run: `npm ci`

Expected: exit 0 z lockfile; nie jest wymagana żadna instalacja systemowa.

Run: `npm run data:validate`

Expected: exit 0, 30 unikalnych TERYT, zero błędnych geometrii, maksymalna różnica powierzchni ≤1%.

Run: `npm run data:repro`

Expected: exit 0, identyczne sumy dwóch czystych wyników.

Run: `npm test`

Expected: wszystkie testy jednostkowe i integracyjne PASS; zapisz liczbę testów.

Run: `npm run build`

Expected: exit 0, statyczny `dist`.

Run: `npm run test:e2e`

Expected: wszystkie journeys PASS; zapisz liczbę testów i przeglądarki.

Run: `npm run test:a11y`

Expected: PASS, zero naruszeń serious/critical.

Run: `Get-FileHash public\data\manifest.json -Algorithm SHA256`

Expected: 64-znakowa suma SHA-256 do raportu.

Run: `git status --short --branch`

Expected: gałąź implementacyjna bez nieoczekiwanych zmian; `test-results/` jest ignorowany.

Raport końcowy zawiera hash commita audytowanego po commicie dokumentacji, pełne komendy i liczby PASS, hash manifestu, podsumowanie raportu walidacji, asercję sieci, trzy screenshoty, wynik axe, JSON Reset before/after, projekty/przeglądarki Playwright oraz wersje Node i pakietów. Dowody muszą pochodzić z ostatniego uruchomienia dokładnie na przekazywanym commicie; jeśli commit README zmieni hash po audycie, powtórz cały audit na nowym HEAD.

- [ ] **Step 6: Commit dokumentacji przed ostatnim powtórzeniem audytu**

```powershell
git add README.md docs/evidence/.gitkeep tests/readme.test.js
git commit -m "docs: document data and verification workflow"
```

- [ ] **Step 7: Powtórz audit i przygotuj handoff**

Powtórz wszystkie komendy ze Step 5 na nowym HEAD. Expected: wszystkie wyniki zielone, dowody mają timestamp ostatniego uruchomienia, `git status --short --branch` jest czysty, a raport wskazuje dokładny `git rev-parse HEAD`.
