const copyView = (view) => ({
  center: [...view.center],
  zoom: view.zoom,
});

export function createInitialState({ view, viewportMode }) {
  return {
    overlaysById: {},
    overlayOrder: [],
    selectedCityId: null,
    selectedOverlayId: null,
    searchQuery: "",
    desktopPanel: "open",
    mobilePanel: "half",
    viewportMode,
    initialView: copyView(view),
    currentView: copyView(view),
  };
}

function updateOverlay(state, overlayId, update) {
  const overlay = state.overlaysById[overlayId];
  if (!overlay) return state;
  return {
    ...state,
    overlaysById: {
      ...state.overlaysById,
      [overlayId]: update(overlay),
    },
  };
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case "CREATE_OVERLAY":
      if (state.overlaysById[action.overlay.overlayId]) return state;
      return {
        ...state,
        overlaysById: {
          ...state.overlaysById,
          [action.overlay.overlayId]: {
            ...action.overlay,
            pivot: [...action.overlay.pivot],
            translation: [...action.overlay.translation],
          },
        },
        overlayOrder: [...state.overlayOrder, action.overlay.overlayId],
        selectedCityId: null,
        selectedOverlayId: action.overlay.overlayId,
      };
    case "MOVE_OVERLAY":
      return updateOverlay(state, action.overlayId, (overlay) => ({
        ...overlay,
        translation: [...action.translation],
      }));
    case "ROTATE_OVERLAY":
      return updateOverlay(state, action.overlayId, (overlay) => ({
        ...overlay,
        angle: action.angle,
      }));
    case "SELECT_CITY":
      return {
        ...state,
        selectedCityId: action.cityId,
        selectedOverlayId: null,
      };
    case "SELECT_OVERLAY":
      if (!state.overlaysById[action.overlayId]) return state;
      return {
        ...state,
        selectedCityId: null,
        selectedOverlayId: action.overlayId,
      };
    case "CLEAR_SELECTION":
      return { ...state, selectedCityId: null, selectedOverlayId: null };
    case "DELETE_OVERLAY": {
      if (!action.overlayId || !state.overlaysById[action.overlayId]) return state;
      const overlaysById = { ...state.overlaysById };
      delete overlaysById[action.overlayId];
      return {
        ...state,
        overlaysById,
        overlayOrder: state.overlayOrder.filter((id) => id !== action.overlayId),
        selectedOverlayId:
          state.selectedOverlayId === action.overlayId
            ? null
            : state.selectedOverlayId,
      };
    }
    case "SET_SEARCH":
      return state.searchQuery === action.query
        ? state
        : { ...state, searchQuery: action.query };
    case "SET_VIEW":
      return { ...state, currentView: copyView(action.view) };
    case "SET_VIEWPORT_MODE":
      return { ...state, viewportMode: action.viewportMode };
    case "SET_PANEL":
      return action.mode === "desktop"
        ? { ...state, desktopPanel: action.value }
        : { ...state, mobilePanel: action.value };
    case "RESET_SESSION":
      return createInitialState({
        view: state.initialView,
        viewportMode: state.viewportMode,
      });
    default:
      return state;
  }
}
