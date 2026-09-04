import { describe, expect, it, vi } from "vitest";
import { registerPolandProjection } from "../../src/projection.js";

vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
registerPolandProjection();

const {
  createPolandView,
  fitViewToExtent,
  getMapPadding,
} = await import("../../src/app.js");

describe("map viewport", () => {
  it("allows a zoom level wide enough to show all of Poland", () => {
    expect(createPolandView().getMinZoom()).toBeLessThanOrEqual(1);
  });

  it("fits the country extent around the desktop panel", () => {
    const view = { fit: vi.fn() };
    const extent = [171706.5, 133223.3, 861895.7, 797223.8];

    fitViewToExtent(view, extent, {
      size: [1024, 768],
      viewportWidth: 1024,
      reducedMotion: true,
    });

    expect(view.fit).toHaveBeenCalledWith(extent, {
      size: [1024, 768],
      padding: [70, 70, 70, 390],
      duration: 0,
    });
  });

  it("reserves space for the mobile bottom panel", () => {
    expect(getMapPadding(390)).toEqual([48, 28, 330, 28]);
  });
});
