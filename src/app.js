import OlMap from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import PointerInteraction from "ol/interaction/Pointer.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { loadData } from "./data/repository.js";
import { transformGeometry, getDisplayPivot } from "./domain/geometry.js";
import { createInitialState, sessionReducer } from "./domain/state.js";
import { createStore } from "./domain/store.js";
import { getRotationDelta, normalizeSearch } from "./ui/controls.js";

const INITIAL_VIEW = { center: [500000, 455000], zoom: 6.35 };
const geoJSON = new GeoJSON();
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const population = new Intl.NumberFormat("pl-PL");
const degrees = (radians) => Math.round((radians * 180) / Math.PI);
const radians = (value) => (Number(value) * Math.PI) / 180;
const wrapDegrees = (value) => ((value + 180) % 360 + 360) % 360 - 180;

function styleSet() {
  const original = new Style({
    fill: new Fill({ color: "rgba(183, 79, 54, .20)" }),
    stroke: new Stroke({ color: "#853e31", width: 1.4 }),
  });
  const selectedOriginal = new Style({
    fill: new Fill({ color: "rgba(210, 102, 63, .38)" }),
    stroke: new Stroke({ color: "#67271f", width: 2.6 }),
  });
  const copy = new Style({
    fill: new Fill({ color: "rgba(32, 108, 113, .30)" }),
    stroke: new Stroke({ color: "#0b6267", width: 2 }),
  });
  const selectedCopy = new Style({
    fill: new Fill({ color: "rgba(28, 123, 127, .45)" }),
    stroke: new Stroke({ color: "#06484d", width: 3 }),
  });
  return { original, selectedOriginal, copy, selectedCopy };
}

function createScene(target, data, store) {
  const styles = styleSet();
  const contextSource = new VectorSource({
    features: geoJSON.readFeatures(data.context.poland, {
      dataProjection: "EPSG:2180",
      featureProjection: "EPSG:2180",
    }),
  });
  const voivodeshipSource = new VectorSource({
    features: geoJSON.readFeatures(data.context.voivodeships, {
      dataProjection: "EPSG:2180",
      featureProjection: "EPSG:2180",
    }),
  });
  const originalFeatures = geoJSON.readFeatures(
    { type: "FeatureCollection", features: data.cities },
    { dataProjection: "EPSG:2180", featureProjection: "EPSG:2180" },
  );
  const originalsById = new Map(
    originalFeatures.map((feature) => {
      feature.set("kind", "original");
      return [feature.get("cityId"), feature];
    }),
  );
  const originalSource = new VectorSource({ features: originalFeatures });
  const labelSource = new VectorSource({
    features: data.cities.map(
      ({ properties }) =>
        new Feature({
          geometry: new Point(properties.pivot),
          kind: "label",
          name: properties.name.replace(/^m\.st\.\s*/i, ""),
          rank: properties.rank,
        }),
    ),
  });
  const overlaySource = new VectorSource();
  const handleSource = new VectorSource();

  const layers = {
    country: new VectorLayer({
      source: contextSource,
      style: new Style({
        fill: new Fill({ color: "#eee9dc" }),
        stroke: new Stroke({ color: "#3d504d", width: 1.6 }),
      }),
    }),
    voivodeships: new VectorLayer({
      source: voivodeshipSource,
      style: new Style({
        fill: new Fill({ color: "rgba(255,255,255,.04)" }),
        stroke: new Stroke({ color: "rgba(79,98,92,.42)", width: 0.8 }),
      }),
    }),
    originals: new VectorLayer({
      source: originalSource,
      declutter: false,
      style: (feature) =>
        store.getState().selectedCityId === feature.get("cityId")
          ? styles.selectedOriginal
          : styles.original,
    }),
    labels: new VectorLayer({
      source: labelSource,
      declutter: true,
      style: (feature) =>
        new Style({
          text: new Text({
            text: feature.get("name"),
            font: feature.get("rank") <= 10 ? "600 12px system-ui" : "500 11px system-ui",
            fill: new Fill({ color: "#293936" }),
            stroke: new Stroke({ color: "rgba(247,244,235,.92)", width: 3 }),
            offsetY: -9,
          }),
        }),
    }),
    overlays: new VectorLayer({
      source: overlaySource,
      style: (feature) =>
        store.getState().selectedOverlayId === feature.get("overlayId")
          ? styles.selectedCopy
          : styles.copy,
    }),
    handles: new VectorLayer({
      source: handleSource,
      style: new Style({
        image: new Circle({
          radius: 6,
          fill: new Fill({ color: "#f7f1df" }),
          stroke: new Stroke({ color: "#06484d", width: 2.5 }),
        }),
      }),
    }),
  };

  const map = new OlMap({
    target,
    layers: Object.values(layers),
    controls: defaultControls({ attribution: false, rotate: false }),
    view: new View({
      projection: "EPSG:2180",
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      minZoom: 5.4,
      maxZoom: 13,
    }),
  });

  function sync() {
    const state = store.getState();
    overlaySource.clear(true);
    for (const overlayId of state.overlayOrder) {
      const overlay = state.overlaysById[overlayId];
      const city = data.citiesById.get(overlay.cityId);
      const feature = geoJSON.readFeature(
        {
          type: "Feature",
          properties: {
            kind: "copy",
            overlayId,
            cityId: overlay.cityId,
            name: city.properties.name,
          },
          geometry: transformGeometry(city.geometry, overlay),
        },
        { dataProjection: "EPSG:2180", featureProjection: "EPSG:2180" },
      );
      overlaySource.addFeature(feature);
    }
    handleSource.clear(true);
    const selected = state.overlaysById[state.selectedOverlayId];
    if (selected) {
      handleSource.addFeature(
        new Feature({
          geometry: new Point(getDisplayPivot(selected)),
          kind: "handle",
          overlayId: selected.overlayId,
        }),
      );
    }
    layers.originals.changed();
    layers.overlays.changed();
  }

  function fitFeature(feature) {
    if (!feature) return;
    map.getView().fit(feature.getGeometry().getExtent(), {
      size: map.getSize(),
      padding:
        innerWidth < 768 ? [48, 28, 330, 28] : [70, 70, 70, 390],
      maxZoom: 10.3,
      duration: prefersReducedMotion.matches ? 0 : 350,
    });
  }

  function focusSelection() {
    const state = store.getState();
    if (state.selectedOverlayId) {
      fitFeature(
        overlaySource
          .getFeatures()
          .find(
            (feature) =>
              feature.get("overlayId") === state.selectedOverlayId,
          ),
      );
    } else if (state.selectedCityId) {
      fitFeature(originalsById.get(state.selectedCityId));
    }
  }

  return {
    map,
    layers,
    originalsById,
    overlaySource,
    sync,
    focusSelection,
    resetView() {
      map.getView().setCenter([...INITIAL_VIEW.center]);
      map.getView().setZoom(INITIAL_VIEW.zoom);
    },
  };
}

function createPointerInteraction(scene, data, store, announce) {
  let drag = null;
  let sequence = 0;
  const interaction = new PointerInteraction({
    handleDownEvent(event) {
      let hit = null;
      scene.map.forEachFeatureAtPixel(
        event.pixel,
        (feature, layer) => {
          if (
            !hit &&
            (layer === scene.layers.overlays || layer === scene.layers.originals)
          ) {
            hit = feature;
          }
        },
        { hitTolerance: 5 },
      );
      if (!hit) return false;
      const kind = hit.get("kind");
      if (kind === "copy") {
        const overlay = store.getState().overlaysById[hit.get("overlayId")];
        store.dispatch({ type: "SELECT_OVERLAY", overlayId: overlay.overlayId });
        drag = {
          kind,
          cityId: overlay.cityId,
          overlayId: overlay.overlayId,
          startCoordinate: event.coordinate,
          startPixel: event.pixel,
          baseTranslation: overlay.translation,
          created: true,
        };
      } else {
        const cityId = hit.get("cityId");
        store.dispatch({ type: "SELECT_CITY", cityId });
        drag = {
          kind,
          cityId,
          startCoordinate: event.coordinate,
          startPixel: event.pixel,
          baseTranslation: [0, 0],
          created: false,
        };
      }
      return true;
    },
    handleDragEvent(event) {
      if (!drag) return;
      const pixelDistance = Math.hypot(
        event.pixel[0] - drag.startPixel[0],
        event.pixel[1] - drag.startPixel[1],
      );
      if (!drag.created && pixelDistance >= 6) {
        drag.overlayId = `kopia-${Date.now().toString(36)}-${++sequence}`;
        const city = data.citiesById.get(drag.cityId);
        store.dispatch({
          type: "CREATE_OVERLAY",
          overlay: {
            overlayId: drag.overlayId,
            cityId: drag.cityId,
            pivot: city.properties.pivot,
            translation: [0, 0],
            angle: 0,
          },
        });
        drag.created = true;
        announce(`Utworzono kopię miasta ${city.properties.name}`);
      }
      if (drag.created) {
        store.dispatch({
          type: "MOVE_OVERLAY",
          overlayId: drag.overlayId,
          translation: [
            drag.baseTranslation[0] +
              event.coordinate[0] -
              drag.startCoordinate[0],
            drag.baseTranslation[1] +
              event.coordinate[1] -
              drag.startCoordinate[1],
          ],
        });
      }
    },
    handleUpEvent() {
      if (drag && drag.kind === "original" && !drag.created) {
        scene.focusSelection();
        announce(
          `Wybrano ${data.citiesById.get(drag.cityId).properties.name}`,
        );
      }
      drag = null;
      return false;
    },
  });
  scene.map.addInteraction(interaction);
  return interaction;
}

function createPanel(root, data, store, scene, announce) {
  const list = root.querySelector("#city-list");
  const search = root.querySelector("#city-search");
  const selection = root.querySelector("#selection-controls");
  const selectionName = root.querySelector("#selection-name");
  const angleOutput = root.querySelector("#angle-output");
  const angleSlider = root.querySelector("#angle-slider");
  const copyCount = root.querySelector("#copy-count");
  let listKey = "";

  function renderList() {
    const state = store.getState();
    const key = `${state.searchQuery}|${state.selectedCityId}`;
    if (key === listKey) return;
    listKey = key;
    const query = normalizeSearch(state.searchQuery);
    list.replaceChildren();
    for (const city of data.cities) {
      const properties = city.properties;
      if (query && !normalizeSearch(properties.name).includes(query)) continue;
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "city-button";
      button.dataset.cityId = properties.cityId;
      button.setAttribute(
        "aria-pressed",
        String(state.selectedCityId === properties.cityId),
      );
      const title = document.createElement("span");
      title.className = "city-name";
      title.textContent = `${properties.rank}. ${properties.name}`;
      const metric = document.createElement("span");
      metric.className = "city-population";
      metric.textContent = `${population.format(properties.population)} mieszk.`;
      button.append(title, metric);
      button.addEventListener("click", () => {
        store.dispatch({ type: "SELECT_CITY", cityId: properties.cityId });
        scene.focusSelection();
        announce(`Wybrano ${properties.name}`);
      });
      item.append(button);
      list.append(item);
    }
    root.querySelector("#results-count").textContent =
      `${list.children.length} z 30 miast`;
  }

  function render() {
    const state = store.getState();
    renderList();
    const overlay = state.overlaysById[state.selectedOverlayId];
    selection.hidden = !overlay;
    if (overlay) {
      const city = data.citiesById.get(overlay.cityId);
      const angle = degrees(overlay.angle);
      selectionName.textContent = city.properties.name;
      angleSlider.value = String(angle);
      angleOutput.textContent = `${angle}°`;
    }
    copyCount.textContent = `${state.overlayOrder.length}`;
    document.body.classList.toggle(
      "panel-collapsed",
      state.desktopPanel === "collapsed",
    );
  }

  search.addEventListener("input", () =>
    store.dispatch({ type: "SET_SEARCH", query: search.value }),
  );
  angleSlider.addEventListener("input", () => {
    const overlayId = store.getState().selectedOverlayId;
    if (overlayId) {
      store.dispatch({
        type: "ROTATE_OVERLAY",
        overlayId,
        angle: radians(angleSlider.value),
      });
    }
  });
  root.querySelector("#center-selection").addEventListener("click", () =>
    scene.focusSelection(),
  );
  root.querySelector("#delete-copy").addEventListener("click", () => {
    const state = store.getState();
    const overlay = state.overlaysById[state.selectedOverlayId];
    if (!overlay) return;
    const name = data.citiesById.get(overlay.cityId).properties.name;
    store.dispatch({ type: "DELETE_OVERLAY", overlayId: overlay.overlayId });
    announce(`Usunięto kopię miasta ${name}`);
  });
  root.querySelector("#reset-map").addEventListener("click", () => {
    store.dispatch({ type: "RESET_SESSION" });
    search.value = "";
    listKey = "";
    scene.resetView();
    announce("Mapa została zresetowana");
  });
  root.querySelector("#panel-toggle").addEventListener("click", () => {
    const value =
      store.getState().desktopPanel === "open" ? "collapsed" : "open";
    store.dispatch({ type: "SET_PANEL", mode: "desktop", value });
  });
  store.subscribe(render);
  render();
}

export async function startApp({ root = document } = {}) {
  const loading = root.querySelector("#loading-state");
  const error = root.querySelector("#error-state");
  const shell = root.querySelector("#app-shell");
  const live = root.querySelector("#live-region");
  const announce = (message) => {
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = message;
    });
  };
  try {
    const data = await loadData();
    const viewportMode = innerWidth < 768 ? "mobile" : "desktop";
    const store = createStore(
      sessionReducer,
      createInitialState({ view: INITIAL_VIEW, viewportMode }),
    );
    const scene = createScene(root.querySelector("#map"), data, store);
    store.subscribe(scene.sync);
    createPointerInteraction(scene, data, store, announce);
    createPanel(root, data, store, scene, announce);
    window.addEventListener("keydown", (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type !== "range"
      ) {
        return;
      }
      const delta = getRotationDelta(event);
      const overlayId = store.getState().selectedOverlayId;
      if (!delta || !overlayId) return;
      event.preventDefault();
      const overlay = store.getState().overlaysById[overlayId];
      store.dispatch({
        type: "ROTATE_OVERLAY",
        overlayId,
        angle: radians(wrapDegrees(degrees(overlay.angle) + delta)),
      });
    });
    loading.hidden = true;
    shell.hidden = false;
    scene.map.updateSize();
    return { data, store, scene };
  } catch (cause) {
    loading.hidden = true;
    error.hidden = false;
    error.querySelector("p").textContent = cause.message;
    throw cause;
  }
}
