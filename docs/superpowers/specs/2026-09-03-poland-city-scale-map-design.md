# Mapa skali polskich miast — specyfikacja projektu

Data dokumentu: 2026-09-03

## 1. Cel i zakres

Pierwsza wersja produktu to statyczna, jednopodstronowa aplikacja webowa zbudowana w vanilla JavaScript, Vite i OpenLayers. Aplikacja pokazuje jasną, atlasową mapę Polski oraz oficjalne granice administracyjne 30 największych miast według liczby ludności. Użytkownik może przenosić kopie obrysów miast w inne miejsca, obracać je i bezpośrednio porównywać ich powierzchnię oraz kształt w tej samej skali.

Aplikacja:

- działa po zbudowaniu jako zbiór plików statycznych;
- nie wymaga serwera aplikacyjnego, API ani zewnętrznych kafli mapowych w czasie działania;
- ładuje automatycznie wyłącznie zasoby z własnego originu, w tym fonty, ikony i dane;
- zachowuje geometrię roboczą i wszystkie przekształcenia w metrach w układzie EPSG:2180;
- pokazuje oryginalne położenie każdego miasta niezależnie od liczby utworzonych kopii;
- obsługuje równocześnie wiele ruchomych kopii tego samego i różnych miast.

Poza zakresem pierwszej wersji są miasta spoza Polski, więcej niż 30 pozycji rankingu, aglomeracje i obszary metropolitalne, porównania demograficzne inne niż wybór rankingu, edycja granic oraz zapis sesji na serwerze. Obrysy oznaczają wyłącznie oficjalne granice administracyjne miast, a nie zasięg zwartej zabudowy.

## 2. Źródła danych i pochodzenie

### 2.1. Granice miast

Źródłem geometrii jest warstwa `A04_Granice_miast` Państwowego Rejestru Granic (PRG), publikowana przez Główny Urząd Geodezji i Kartografii. Snapshot jest pobierany w GML z oficjalnej usługi WFS PRG dla konkretnej daty, zapisanej w manifeście. Z warstwy wybierane są rekordy odpowiadające 30 miastom rankingu poprzez identyfikator TERYT, nie poprzez samo porównanie nazw. Wieloczłonowe i powtarzające się nazwy nie mogą wpływać na wynik dopasowania.

### 2.2. Ranking ludności

Ranking powstaje z najnowszej dostępnej w chwili przygotowania snapshotu oficjalnej tabeli Głównego Urzędu Statystycznego zawierającej ludność miast. Data stanu ludności jest zapisana w manifeście danych i widoczna w atrybucji aplikacji. Rekordy są sortowane malejąco po liczbie ludności; przy równej wartości kolejność rozstrzyga rosnący kod TERYT. Pozycje 1–30 są zamrażane w wersjonowanym snapshocie, dlatego późniejsza publikacja GUS nie zmienia działającej aplikacji bez jawnej aktualizacji danych.

### 2.3. Warstwy kontekstowe

Granica Polski i granice województw pochodzą z PRG. Przebieg Wisły pochodzi z oficjalnych danych topograficznych BDOT10k GUGiK. Etykiety państwa, województw i wybranych punktów orientacyjnych są generowane lokalnie z wersjonowanego pliku konfiguracyjnego. Warstwy kontekstowe są uproszczone mocniej niż granice miast, ponieważ służą wyłącznie orientacji.

### 2.4. Snapshot i manifest

Repozytorium zawiera przetworzone, gotowe do użycia pliki danych oraz manifest. Surowe paczki źródłowe nie muszą być przechowywane w Git, jeśli ich licencja lub rozmiar na to nie pozwala, ale manifest musi umożliwiać odtworzenie snapshotu. Manifest zawiera dla każdego źródła:

- nazwę instytucji i zbioru;
- publiczny adres strony pobrania;
- datę pobrania i datę obowiązywania danych;
- nazwę i sumę SHA-256 pobranego pliku;
- informację licencyjną i wymagany tekst atrybucji;
- wersję skryptu preprocessingu;
- listę 30 miast: miejsce w rankingu, nazwę, TERYT i liczbę ludności;
- parametry reprojekcji i uproszczenia;
- sumy SHA-256 plików wynikowych.

Interfejs pokazuje stale dostępny odnośnik „Źródła danych”, otwierający panel z atrybucją PRG/GUGiK, BDOT10k/GUGiK i GUS oraz datami danych. Atrybucja nie może być ukryta przez panel miast ani kontrolki mapy.

## 3. Pipeline danych

Preprocessing jest procesem uruchamianym przed buildem, a nie w przeglądarce. Jego wynik jest wersjonowany razem z aplikacją.

1. Odczytaj dane GUS, znormalizuj TERYT do stałego formatu tekstowego i wyznacz deterministyczny ranking.
2. Wybierz dokładnie 30 geometrii `A04_Granice_miast` przez TERYT.
3. Napraw odwrócone pierścienie i możliwe błędy topologii bez zmiany semantycznej granic.
4. Przereprojektuj geometrie oraz warstwy kontekstowe do EPSG:2180.
5. Uprość granice miast algorytmem zachowującym topologię. Zacznij od tolerancji 50 m i zmniejszaj ją o połowę dla pojedynczego miasta, dopóki geometria jest poprawna, liczba części się nie zmienia, a względna różnica powierzchni wobec geometrii po reprojekcji nie przekracza 1%.
6. Uprość warstwy kontekstowe z tolerancją 150 m, zachowując poprawność topologiczną.
7. Zapisz wynik jako lokalne pliki GeoJSON z współrzędnymi w EPSG:2180 oraz osobny manifest JSON. Loader przekazuje OpenLayers jawnie `dataProjection: "EPSG:2180"`; nie polega na polu `crs` GeoJSON.
8. Wygeneruj raport walidacji i zakończ proces kodem różnym od zera przy każdym naruszeniu reguł z sekcji 9.

Każdy obiekt miasta zawiera wyłącznie pola potrzebne w runtime: `cityId` równe TERYT, nazwę, miejsce w rankingu, liczbę ludności i geometrię `Polygon` albo `MultiPolygon`. Powierzchnia prezentowana użytkownikowi jest liczona z nieuproszczonej geometrii po reprojekcji podczas preprocessingu i zapisana w metadanych; interakcje używają geometrii uproszczonej.

## 4. Architektura aplikacji

### 4.1. Moduły

- **Bootstrap i konfiguracja mapy** rejestrują EPSG:2180 przez `proj4`, tworzą widok OpenLayers i ładują lokalne zasoby.
- **Repozytorium danych** wczytuje manifest, miasta i warstwy kontekstowe, sprawdza ich wersje oraz udostępnia dane po `cityId`.
- **Warstwy mapy** utrzymują oddzielne źródła OpenLayers dla tła atlasowego, oryginalnych obrysów miast i ruchomych kopii.
- **Model stanu** jest jedynym źródłem prawdy dla kopii, zaznaczenia, wyszukiwania i ustawień panelu.
- **Silnik geometrii** tworzy geometrię renderowaną na podstawie niezmienianej geometrii miasta i parametrów transformacji.
- **Kontrolery interakcji** obsługują wskazywanie, przeciąganie, obrót, usuwanie, centrowanie, zoom i skróty klawiaturowe.
- **Interfejs HTML** renderuje listę, wyszukiwarkę, panel szczegółów zaznaczenia, komunikaty błędów i atrybucję.

Granice modułów mają pozostać niezależne od DOM tam, gdzie nie jest on konieczny. Funkcje geometrii i reduktor stanu są czyste, dzięki czemu można je testować bez OpenLayers i przeglądarki.

### 4.2. Układ współrzędnych

Widok mapy, geometrie i parametry przesunięcia działają w EPSG:2180. Wartości `dx` i `dy` są metrami. Kąt jest przechowywany w radianach, dodatni przeciwnie do ruchu wskazówek zegara. Formatowanie stopni w interfejsie nie zmienia reprezentacji stanu.

Nie wolno wykonywać obrotu ani obliczać powierzchni w EPSG:4326. EPSG:4326 może być użyte jedynie na granicy systemu, gdy narzędzie testowe albo link wymaga współrzędnych geograficznych.

### 4.3. Oryginały i ruchome kopie

Oryginalne geometrie są tylko do odczytu i zawsze pozostają w warstwie oryginałów. Pierwsze przeciągnięcie oryginału po przekroczeniu progu 6 pikseli tworzy nową kopię, zaznacza ją i przesuwa; klik bez przekroczenia progu jedynie zaznacza miasto. Przeciągnięcie istniejącej kopii aktualizuje tę kopię i nie tworzy następnej.

Każda kopia ma stan:

```text
{
  overlayId: string,
  cityId: string,
  translation: [dx, dy],
  angle: number,
  pivot: [x, y]
}
```

`overlayId` jest unikalny w sesji. `pivot` jest wyznaczany raz przy utworzeniu kopii jako środek powierzchni niezmienionej geometrii miasta w EPSG:2180 i pozostaje stały przez cały czas życia kopii. Dla punktu geometrii `p` wynik oblicza się wzorem:

```text
p' = R(angle) × (p - pivot) + pivot + translation
```

Wyświetlany punkt obrotu to `pivot + translation`. Geometria wynikowa jest za każdym razem liczona z oryginału i bieżącego stanu, nigdy przez kolejne mutacje poprzedniego wyniku. Zapobiega to kumulacji błędów numerycznych i zmianie powierzchni.

## 5. Wygląd i zachowanie

### 5.1. Mapa

Mapa zajmuje cały viewport i ma jasny, papierowy styl atlasowy. Nie używa podkładu rastrowego ani zewnętrznych kafli. Tło obejmuje:

- wyraźny obrys Polski;
- subtelne granice województw;
- zaakcentowany przebieg Wisły;
- stonowane etykiety Polski, województw i najważniejszych punktów orientacyjnych.

Oryginalne miasta otrzymują półprzezroczyste wypełnienia i czytelne kontury. Kolor jest deterministycznie przypisany do `cityId`; wszystkie kopie danego miasta zachowują ten kolor. Kopie mają mocniejszy kontur niż oryginały, a zaznaczona kopia dodatkowy kontrastowy halo. Etykieta pokazuje nazwę miasta i podąża za wyświetlanym środkiem kopii. Etykiety unikają zasłaniania uchwytu obrotu.

### 5.2. Panel miast

Na ekranie szerokim panel jest przypięty do lewej krawędzi i można go zwinąć do wąskiego przycisku. Zawiera:

- wyszukiwarkę filtrującą po nazwie bez rozróżniania wielkości liter i polskich znaków;
- uporządkowaną listę dokładnie 30 miast z miejscem, nazwą i liczbą ludności;
- szczegóły zaznaczonego miasta lub kopii, w tym powierzchnię administracyjną;
- akcje „Wyśrodkuj”, „Usuń kopię” i „Reset”;
- skróconą instrukcję przeciągania i obracania.

Kliknięcie elementu listy zaznacza oryginalne miasto i animuje widok tak, by jego granice zajęły nie więcej niż 60% dostępnego obszaru mapy po uwzględnieniu panelu. Gdy wyszukiwanie nie daje wyników, panel pokazuje komunikat „Brak miasta w pierwszej trzydziestce”, nie pustą przestrzeń.

### 5.3. Przenoszenie, obrót i akcje

- Przeciągnięcie oryginału tworzy kopię i pozostawia oryginał na miejscu.
- Kolejne przeciągnięcia oryginału mogą tworzyć następne kopie.
- Przeciągnięcie kopii zmienia wyłącznie jej `translation`.
- Obrót jest dostępny przez uchwyt na mapie oraz suwak w panelu w zakresie od −180° do 180°.
- Gdy kopia jest zaznaczona, klawisze `[` i `]` obracają ją odpowiednio o −1° i +1°, a z klawiszem Shift o −15° i +15°. Skróty nie działają podczas pisania w polu formularza.
- `Delete` otwiera w panelu potwierdzenie usunięcia zaznaczonej kopii; `Enter` potwierdza, a `Escape` anuluje. Przycisk „Usuń kopię” uruchamia ten sam przepływ. Oryginału nie można usunąć.
- „Wyśrodkuj” dopasowuje widok do zaznaczonego oryginału albo przekształconej kopii.
- `Escape` anuluje potwierdzenie usunięcia, bieżący drag lub obrót; jeśli żaden z tych trybów nie jest aktywny, usuwa zaznaczenie.
- „Reset” usuwa wszystkie kopie, zaznaczenie i tekst wyszukiwania, ustawia kąt kontrolek na 0°, przywraca początkowy widok całej Polski i domyślny stan panelu. Nie przeładowuje strony.

Zoom i przesuwanie mapy pozostają dostępne przyciskiem, kółkiem, gestem szczypania i przeciąganiem pustego obszaru. Interakcja kopii ma pierwszeństwo tylko wtedy, gdy wskaźnik rozpoczął ruch na geometrii lub jej uchwycie.

### 5.4. Widok mobilny

Przy szerokości viewportu poniżej 768 px panel zmienia się w dolny arkusz. Ma trzy stabilne pozycje: zwiniętą, pośrednią zajmującą 45% wysokości i pełną zajmującą 85% wysokości. Uchwyt arkusza ma co najmniej 44 × 44 px. Mapa dopasowuje padding do aktualnej wysokości arkusza, aby wyśrodkowane miasto nie było przez niego zasłonięte. Lista, wyszukiwanie, usuwanie, centrowanie, Reset i suwak obrotu zachowują pełną funkcjonalność dotykową.

## 6. Dostępność

- Wszystkie funkcje panelu są dostępne klawiaturą w logicznej kolejności fokusu.
- Przyciski mają widoczne etykiety tekstowe lub jednoznaczne `aria-label`; stan zwinięcia używa `aria-expanded`.
- Lista miast używa semantycznej listy, a aktywne miasto lub kopia ma programowo dostępny stan zaznaczenia.
- Po utworzeniu, usunięciu i resecie kopii region `aria-live="polite"` ogłasza wynik działania.
- Uchwyt mapowy nie jest jedyną metodą obrotu: suwak i skróty zapewniają równoważną obsługę.
- Minimalny rozmiar dotykowego celu wynosi 44 × 44 px.
- Tekst i kontrolki spełniają WCAG 2.2 AA: kontrast tekstu co najmniej 4,5:1, dużego tekstu 3:1, elementów nietekstowych 3:1.
- Fokus jest zawsze widoczny i nie jest przykrywany przez panel.
- Preferencja `prefers-reduced-motion` wyłącza animowany zoom, przesuwanie panelu i dekoracyjne przejścia bez utraty informacji.
- Kolor nie jest jedynym wyróżnikiem: zaznaczenie i rozróżnienie oryginału od kopii wykorzystują również kontur, halo i opis.
- Przy powiększeniu strony do 200% nie znika żadna akcja i nie pojawia się poziome przewijanie panelu.

## 7. Stan i przepływ danych

Stan sesji obejmuje:

- słownik kopii indeksowany przez `overlayId`;
- kolejność renderowania kopii;
- `selectedCityId` albo `selectedOverlayId`, wzajemnie wykluczające się;
- tekst wyszukiwania;
- stan panelu odpowiedni dla desktopu lub mobile;
- początkowy i bieżący stan widoku mapy.

Zmiany przechodzą przez jawne akcje reduktora, między innymi `CREATE_OVERLAY`, `MOVE_OVERLAY`, `ROTATE_OVERLAY`, `SELECT_CITY`, `SELECT_OVERLAY`, `DELETE_OVERLAY` i `RESET_SESSION`. OpenLayers renderuje projekcję stanu, ale nie przechowuje autorytatywnych transformacji w cechach warstwy. Reset jest pojedynczą akcją atomową i nie pozostawia osieroconych cech ani uchwytów.

Stan jest nietrwały: odświeżenie strony rozpoczyna nową sesję. To świadome ograniczenie pierwszej wersji.

## 8. Obsługa błędów

Aplikacja odróżnia błąd krytyczny od problemu pojedynczej funkcji:

- brak manifestu, niezgodna wersja danych, brak pliku miast, niepoprawny układ współrzędnych lub liczba miast różna od 30 blokują mapę i pokazują pełnoekranowy komunikat z przyciskiem ponowienia;
- nieudane wczytanie warstwy kontekstowej pozostawia działające porównywanie miast, pokazuje nieinwazyjne ostrzeżenie i wymienia brakującą warstwę;
- błąd utworzenia lub transformacji kopii nie zmienia stanu, ogłasza komunikat dostępności i pozwala kontynuować pracę;
- nieobsługiwane WebGL nie jest błędem krytycznym, ponieważ podstawowym rendererem warstw wektorowych jest Canvas 2D.

Komunikaty dla użytkownika są po polsku i nie pokazują surowego stack trace. Szczegóły techniczne mogą trafić do konsoli w trybie deweloperskim. Ponowienie wczytuje zasoby jeszcze raz bez pełnego odświeżenia strony.

## 9. Walidacja danych

Pipeline kończy się błędem, jeżeli nie jest spełniony choć jeden warunek:

- ranking zawiera dokładnie 30 unikalnych kodów TERYT i miejsca od 1 do 30 bez luk;
- każdemu TERYT odpowiada dokładnie jedna cecha miasta;
- nazwa nie jest pusta, ludność jest dodatnią liczbą całkowitą, a kolejność odpowiada regule sortowania;
- każda geometria jest niepusta, poprawna topologicznie i ma typ `Polygon` lub `MultiPolygon`;
- wszystkie współrzędne mieszczą się w oczekiwanym zakresie EPSG:2180 dla Polski;
- uproszczenie nie zmienia liczby części geometrii miasta, nie wprowadza samoprzecięć i nie zmienia powierzchni o więcej niż 1%;
- środek powierzchni używany jako pivot jest skończoną parą współrzędnych;
- sumy SHA-256 źródeł i wyników odpowiadają manifestowi;
- atrybucja i daty obowiązywania istnieją dla każdego źródła;
- wynikowe `cityId` są stabilne między uruchomieniami na tym samym snapshocie.

Test odtwarzalności uruchamia preprocessing dwa razy w czystych katalogach i porównuje sumy plików wynikowych. Kolejność cech i kluczy JSON jest deterministyczna.

## 10. Strategia testów i TDD

Każde zachowanie jest rozwijane w cyklu: test nie przechodzi, minimalna implementacja powoduje przejście testu, następnie refaktoryzacja przy zielonym zestawie. Testy nie mogą opierać się wyłącznie na snapshotach obrazu.

### 10.1. Testy jednostkowe geometrii

Testy czystych funkcji obejmują:

- przesunięcie o znany wektor w metrach;
- obrót o 0°, 90°, −90° i 360° wokół ustalonego pivotu;
- zachowanie powierzchni po przesunięciu i obrocie z tolerancją względną `1e-9`;
- niezmienność pivotu w stanie przy kolejnych ruchach i obrotach;
- zgodność wyświetlanego pivotu z `pivot + translation`;
- odwracalność: transformacja odwrotna przywraca każdy punkt z błędem najwyżej `1e-7` m;
- brak dryfu po 100 naprzemiennych zmianach kąta i przesunięcia, ponieważ wynik powstaje z geometrii źródłowej;
- poprawną obsługę `Polygon` i `MultiPolygon`.

### 10.2. Testy jednostkowe stanu

Reduktor jest testowany dla tworzenia wielu kopii jednego miasta, niezależnego przesuwania i obracania kopii, selekcji, usuwania oraz niedozwolonego usuwania oryginału. Test `RESET_SESSION` potwierdza atomowo pusty słownik i kolejność kopii, brak zaznaczenia, pustą wyszukiwarkę, domyślny panel i początkowy widok. Osobny test potwierdza brak mutacji poprzedniego stanu.

### 10.3. Testy integracyjne

Testy integracyjne obejmują:

- wczytanie lokalnego manifestu i dokładnie 30 miast;
- jawne odczytanie GeoJSON jako EPSG:2180;
- utworzenie cechy kopii ze stanu i aktualizację warstwy bez modyfikacji oryginału;
- synchronizację uchwytu, suwaka, etykiety i stanu kąta;
- priorytet drag kopii nad przesuwaniem mapy oraz przesuwanie mapy z pustego obszaru;
- filtrowanie nazw z polskimi znakami i bez nich;
- tryb pełnego błędu oraz degradację po braku pojedynczej warstwy kontekstowej;
- dostępne komunikaty `aria-live` dla utworzenia, usunięcia i Resetu.

### 10.4. Testy end-to-end Playwright

Scenariusze działają na zbudowanej aplikacji serwowanej lokalnie, z odłączoną siecią zewnętrzną:

1. Otwórz aplikację w desktopowym viewportcie i potwierdź widok całej Polski, listę 30 miast oraz brak żądań do obcych domen.
2. Wybierz Lublin z listy, sprawdź przybliżenie, przeciągnij jego oryginalny obrys obok Rzeszowa i potwierdź, że oryginał pozostał w Lublinie, a istnieje jedna zaznaczona kopia przy Rzeszowie.
3. Obróć kopię uchwytem, suwakiem i klawiaturą; po każdym kroku porównaj kąt stanu z widoczną kontrolką i potwierdź niezmienioną powierzchnię.
4. Zmień zoom i przeciągnij pusty obszar mapy, potwierdzając zachowanie kopii.
5. Utwórz drugą kopię innego miasta i sprawdź, że obie są widoczne oraz niezależne.
6. Usuń jedną kopię, następnie wybierz Reset i potwierdź brak wszystkich kopii, początkowy widok Polski, pustą wyszukiwarkę i domyślny panel.
7. Uruchom scenariusz mobilny przy 390 × 844 px: przełącz trzy pozycje dolnego arkusza, wyszukaj miasto, utwórz i obróć kopię dotykiem, użyj „Wyśrodkuj”, a następnie Reset. Sprawdź, że dopasowana geometria nie jest zasłonięta.
8. Uruchom podstawową automatyczną kontrolę dostępności dla stanu początkowego, otwartego panelu i zaznaczonej kopii; brak naruszeń poziomu poważnego i krytycznego jest warunkiem przejścia.

## 11. Kryteria akceptacji

Wersja spełnia wymagania, gdy jednocześnie:

1. Build tworzy statyczną aplikację działającą bez API, zewnętrznych kafli i żądań do obcych domen.
2. Mapa pokazuje lokalne warstwy Polski, województw, Wisły i etykiet w jasnym stylu atlasowym.
3. Panel prezentuje dokładnie 30 miast zgodnych z wersjonowanym rankingiem GUS, a źródła, daty i atrybucja są dostępne w interfejsie.
4. Wszystkie geometrie miast pochodzą z `A04_Granice_miast`, są dopasowane przez TERYT i przetworzone do EPSG:2180.
5. Kliknięcie miasta na liście przybliża mapę do właściwego oryginału.
6. Drag oryginału tworzy niezależną kopię i nie usuwa ani nie przesuwa oryginału; wiele kopii działa równocześnie.
7. Kopię można przesuwać, obracać uchwytem, suwakiem i klawiaturą, wyśrodkować oraz usunąć.
8. Obrót i przesunięcie nie zmieniają powierzchni, pivot pozostaje stały, a transformacja jest odwracalna w ustalonych tolerancjach.
9. Reset atomowo przywraca stan początkowy bez przeładowania strony.
10. Interfejs jest używalny klawiaturą, dotykiem i wskaźnikiem, spełnia opisane wymagania WCAG 2.2 AA i działa w mobilnym układzie dolnego arkusza.
11. Walidacja danych, testy jednostkowe, integracyjne i wszystkie scenariusze Playwright przechodzą na czystym checkoutcie.

## 12. Wymagane dowody końcowe

Przed uznaniem implementacji za zakończoną należy dołączyć do podsumowania:

- hash commita i wynik `git status --short --branch`;
- pełne komendy użyte do instalacji, walidacji danych, testów, builda i Playwright wraz z liczbą testów zakończonych powodzeniem;
- sumę SHA-256 manifestu i raport z walidacji potwierdzający 30 unikalnych TERYT, poprawność geometrii i limity różnicy powierzchni;
- zapis sieciowy lub asercję Playwright potwierdzającą brak żądań do obcych domen;
- zrzut desktopowy po przeciągnięciu Lublina obok Rzeszowa, z widocznym oryginałem i kopią;
- zrzut desktopowy dwóch jednoczesnych, obróconych kopii;
- zrzut mobilny 390 × 844 px z otwartym dolnym arkuszem i niezasłoniętą, wyśrodkowaną kopią;
- wynik automatycznej kontroli dostępności bez naruszeń poważnych i krytycznych;
- dowód Resetu przed i po akcji: liczba kopii, zaznaczenie, wyszukiwanie, panel i widok;
- informację o przeglądarkach użytych w E2E oraz wersjach Node.js i pakietów.

Dowody mają pochodzić z ostatniego uruchomienia na commicie przekazywanym do przeglądu. Same deklaracje bez logu, raportu lub zrzutu nie spełniają kryterium.

## 13. Świadome ograniczenia pierwszej wersji

- Zakres geograficzny obejmuje wyłącznie Polskę.
- Dostępnych jest dokładnie 30 największych miast z zamrożonego snapshotu rankingu.
- Porównywane są oficjalne granice administracyjne; aplikacja nie przedstawia aglomeracji, obszarów metropolitalnych ani zasięgu zabudowy.
- Dane nie aktualizują się automatycznie w runtime.
- Sesja i kopie nie są zapisywane po odświeżeniu.
- Nie ma eksportu obrazu, linku do udostępnienia układu ani własnych danych użytkownika.
