import { describe, expect, it } from "vitest";
import {
  createInitialState,
  sessionReducer,
} from "../../src/domain/state.js";
import { createStore } from "../../src/domain/store.js";

const view = { center: [500000, 450000], zoom: 6.4 };
const overlay = (overlayId) => ({
  overlayId,
  cityId: "1465011",
  pivot: [500000, 450000],
  translation: [0, 0],
  angle: 0,
});

describe("comparison session reducer", () => {
  it("creates multiple copies and changes only the addressed copy", () => {
    let state = createInitialState({ view, viewportMode: "desktop" });
    state = sessionReducer(state, { type: "CREATE_OVERLAY", overlay: overlay("a") });
    state = sessionReducer(state, { type: "CREATE_OVERLAY", overlay: overlay("b") });
    const before = structuredClone(state);
    state = sessionReducer(state, {
      type: "MOVE_OVERLAY",
      overlayId: "a",
      translation: [10, 20],
    });
    state = sessionReducer(state, {
      type: "ROTATE_OVERLAY",
      overlayId: "b",
      angle: Math.PI / 2,
    });
    expect(state.overlayOrder).toEqual(["a", "b"]);
    expect(state.overlaysById.a.translation).toEqual([10, 20]);
    expect(state.overlaysById.b).toMatchObject({
      translation: [0, 0],
      angle: Math.PI / 2,
    });
    expect(before.overlaysById.a.translation).toEqual([0, 0]);
  });

  it("selects, deletes, and atomically resets the complete session", () => {
    const initial = createInitialState({ view, viewportMode: "mobile" });
    let dirty = sessionReducer(initial, {
      type: "CREATE_OVERLAY",
      overlay: overlay("a"),
    });
    dirty = sessionReducer(dirty, { type: "SET_SEARCH", query: "lodz" });
    dirty = sessionReducer(dirty, { type: "DELETE_OVERLAY", overlayId: "a" });
    expect(dirty.overlayOrder).toEqual([]);
    const before = structuredClone(dirty);
    const reset = sessionReducer(dirty, { type: "RESET_SESSION" });
    expect(dirty).toEqual(before);
    expect(reset).toEqual(initial);
  });

  it("notifies store listeners only when state changes", () => {
    const store = createStore(
      sessionReducer,
      createInitialState({ view, viewportMode: "desktop" }),
    );
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: "UNKNOWN" });
    store.dispatch({ type: "SET_SEARCH", query: "Poznań" });
    expect(calls).toBe(1);
    expect(store.getState().searchQuery).toBe("Poznań");
  });
});
