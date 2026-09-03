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

export async function loadData(fetchImpl = fetch) {
  try {
    const manifest = await fetchJson(fetchImpl, "/data/manifest.json");
    const [citiesGeoJSON, poland, voivodeships] = await Promise.all([
      fetchJson(fetchImpl, `/data/${manifest.files.cities}`),
      fetchJson(fetchImpl, `/data/${manifest.files.poland}`),
      fetchJson(fetchImpl, `/data/${manifest.files.voivodeships}`),
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
      context: { poland, voivodeships },
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
