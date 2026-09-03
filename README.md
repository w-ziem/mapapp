# Skala polskich miast

Statyczny, działający bez zewnętrznych usług atlas do porównywania rzeczywistych
granic administracyjnych 30 największych miast w Polsce. Geometrie są mierzone
i przekształcane w państwowym układzie metrycznym EPSG:2180.

## Uruchomienie

Wymagane są Node.js `>=22.18.0 <23` oraz npm `10.9.3`.

```powershell
npm ci
npm run dev
```

Vite wyświetli lokalny adres aplikacji. Kompilacja produkcyjna:

```powershell
npm run build
```

Aplikacja nie pobiera kafli, fontów, danych ani kluczy API w czasie działania.
Wszystkie potrzebne pliki znajdują się w `public/data`.

## Obsługa

- Kliknij miasto na mapie lub liście, aby je wybrać i przybliżyć.
- Przeciągnij oryginalny, ceglasty kontur, aby utworzyć osobną turkusową kopię.
  Oryginał pozostanie na miejscu. Można utworzyć wiele niezależnych kopii.
- Przeciągnij kopię, aby ją przesunąć.
- Obróć zaznaczoną kopię suwakiem albo klawiszami `[` i `]` co 1°.
  `Shift` + `[`/`]` zmienia kąt co 15°.
- `Wyśrodkuj` pokazuje zaznaczoną kopię, a `Usuń kopię` usuwa tylko ją.
- `Resetuj mapę` usuwa kopie, wyszukiwanie i zaznaczenie oraz przywraca widok
  całej Polski bez przeładowania strony.

Na wąskich ekranach panel działa jako kompaktowy arkusz u dołu mapy. Interfejs
ma widoczny fokus, komunikaty `aria-live`, duże cele dotykowe i respektuje
`prefers-reduced-motion`.

## Dane i odtwarzalność

Źródła są zapisane w `data/sources.config.json`, a dokładne adresy, sumy SHA-256
i daty pobrania w `data/sources.lock.json`.

- GUS: „Powierzchnia i ludność w przekroju terytorialnym w 2026 r.”,
  ludność według stanu na 31.12.2025. Ranking malejąco po liczbie ludności,
  z TERYT jako deterministycznym rozstrzygnięciem remisu.
- GUGiK PRG: `A04_Granice_miast`, `A01_Granice_wojewodztw` i
  `A00_Granice_panstwa`, pobrane przez WFS 2.0.
- Join GUS–PRG używa wyłącznie TERYT. Warszawa, Kraków i Łódź są w A04
  reprezentowane przez oficjalne jednostki dzielnic/delegatur (`_8`/`_9`);
  pipeline agreguje wszystkie jednostki o tym samym nadrzędnym kodzie TERYT.

Surowe pobrania są ignorowane przez Git. Aby odtworzyć snapshot:

```powershell
npm run data:download
npm run data:build
npm run data:validate
npm run data:repro
```

`data:download` bez `--refresh` odtwarza pliki zgodne z lockiem; świadomą zmianę
źródeł wykonuje się przez `npm run data:download -- --refresh`.

Snapshot zawiera dokładnie 30 unikalnych miast, Polskę i 16 województw.
Współrzędne są reprojektowane z formalnego porządku osi WFS `yx` do EPSG:2180.
Kontury miast są deterministycznie upraszczane z tolerancją do 40 m, przy
zachowaniu pola w granicy 1%; pole i punkt obrotu liczone są wcześniej z pełnej
geometrii. Transformacje ekranu zawsze powstają z niezmiennej geometrii
snapshotu, więc przesuwanie i obrót nie kumulują błędu.

## Testy

```powershell
npm test
npm run data:validate
npm run data:repro
npm run build
```

Vitest obejmuje downloader i ranking GUS, parser Polygon/MultiPolygon, osie i
reprojekcję GML, walidację snapshotu, zachowanie pola przy obrocie i przesunięciu,
odwrotność transformacji, niemutowalny reducer/store, wiele kopii, Reset,
normalizację polskich znaków, skróty klawiaturowe i krytyczne błędy loadera.

Playwright nie został dodany w przyspieszonym zakresie. Stabilne nazwy
dostępności i atrybuty `data-testid="map"`, `rotation-slider` oraz `reset`
umożliwiają późniejsze testy przeglądarkowe.

## Obecne ograniczenia

- Wisła z BDOT10k jest opcjonalna i pominięta: oficjalny artefakt klasy
  `OT_SWRS_L` to około 201 MB w GeoParquet i wymaga dodatkowego filtra/toolingu.
- Zagregowane dzielnice Warszawy, Krakowa i Łodzi pozostają częściami
  MultiPolygon; obliczenia powierzchni są poprawne, ale przy dużym zbliżeniu
  mogą być widoczne wspólne granice części.
- Obrót używa precyzyjnego suwaka, klawiatury i widocznego punktu obrotu;
  bezpośredni uchwyt obrotu na mapie nie został dodany.
