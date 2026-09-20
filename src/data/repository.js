export class CriticalDataError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "CriticalDataError";
    this.code = code;
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new CriticalDataError("FETCH", `Nie udało się wczytać ${url}`);
  return response.json();
}

const emptyFeatureCollection = () => ({
  type: "FeatureCollection",
  features: [],
});

async function fetchContext(fetchImpl, url, label) {
  try {
    return {
      collection: await fetchJson(fetchImpl, url),
      warning: null,
    };
  } catch {
    return {
      collection: emptyFeatureCollection(),
      warning: `Nie udało się wczytać warstwy kontekstowej ${label}. Porównywanie miast nadal działa.`,
    };
  }
}

export async function loadData(fetchImpl = fetch) {
  try {
    const manifest = await fetchJson(fetchImpl, "/data/manifest.json");
    const citiesGeoJSON = await fetchJson(
      fetchImpl,
      `/data/${manifest.files.cities}`,
    );
    const [polandResult, voivodeshipResult] = await Promise.all([
      fetchContext(fetchImpl, `/data/${manifest.files.poland}`, "Polski"),
      fetchContext(
        fetchImpl,
        `/data/${manifest.files.voivodeships}`,
        "województw",
      ),
    ]);
    const cities = citiesGeoJSON.features ?? [];
    if (
      manifest.crs !== "EPSG:2180" ||
      manifest.cityCount !== 30 ||
      cities.length !== 30 ||
      new Set(cities.map(({ properties }) => properties.cityId)).size !== 30
    ) {
      throw new CriticalDataError(
        "VALIDATION",
        "Lokalny zestaw danych nie zawiera 30 poprawnych miast",
      );
    }
    return {
      manifest,
      cities,
      citiesById: new Map(
        cities.map((city) => [city.properties.cityId, city]),
      ),
      context: {
        poland: polandResult.collection,
        voivodeships: voivodeshipResult.collection,
      },
      warnings: [
        polandResult.warning,
        voivodeshipResult.warning,
      ].filter(Boolean),
    };
  } catch (error) {
    if (error instanceof CriticalDataError) throw error;
    throw new CriticalDataError(
      "LOAD",
      "Nie udało się uruchomić lokalnego atlasu",
      error,
    );
  }
}
