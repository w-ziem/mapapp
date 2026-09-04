import { beforeAll, describe, expect, it, vi } from "vitest";

vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

let createSourcesPanel;
let startApp;
beforeAll(async () => {
  ({ createSourcesPanel, startApp } = await import("../../src/app.js"));
});

function renderShell() {
  document.body.innerHTML = `
    <section id="loading-state"></section>
    <section id="error-state" hidden><p></p><button id="retry-load" type="button">Spróbuj ponownie</button></section>
    <div id="app-shell" hidden><p id="context-warning" hidden></p></div>
    <div id="live-region"></div>
  `;
}

describe("application loading recovery", () => {
  it("retries the same bootstrap path in-app and clears stale error state", async () => {
    renderShell();
    const data = {
      warnings: ["Nie udało się wczytać warstwy kontekstowej Polski."],
    };
    const loadDataImpl = vi.fn()
      .mockRejectedValueOnce(new Error("Pierwsza próba nieudana"))
      .mockResolvedValueOnce(data);
    const mountApp = vi.fn(() => ({ mounted: true }));

    await expect(
      startApp({ root: document, loadDataImpl, mountApp }),
    ).rejects.toThrow("Pierwsza próba nieudana");
    expect(document.querySelector("#error-state").hidden).toBe(false);

    document.querySelector("#retry-load").click();
    await vi.waitFor(() => expect(loadDataImpl).toHaveBeenCalledTimes(2));

    expect(mountApp).toHaveBeenCalledWith(
      expect.objectContaining({ root: document, data }),
    );
    expect(document.querySelector("#loading-state").hidden).toBe(true);
    expect(document.querySelector("#error-state").hidden).toBe(true);
    expect(document.querySelector("#app-shell").hidden).toBe(false);
    expect(document.querySelector("#context-warning").textContent).toMatch(
      /warstwy kontekstowej Polski/i,
    );
  });

  it("renders auditable sources and keeps an accessible disclosure state", () => {
    document.body.innerHTML = `
      <button id="sources-toggle" aria-expanded="false" aria-controls="sources-panel"></button>
      <section id="sources-panel" hidden><div id="sources-list"></div><button id="sources-close"></button></section>
    `;
    const manifest = {
      sources: [{
        institution: "Główny Urząd Statystyczny",
        dataset: "Powierzchnia i ludność",
        landingPage: "https://stat.gov.pl/dataset",
        retrievedAt: "2026-09-03T20:00:00.000Z",
        validAt: "2025-12-31",
        license: "https://stat.gov.pl/license",
        attribution: "Źródło: GUS; informacja przetworzona.",
      }],
    };

    expect(createSourcesPanel).toBeTypeOf("function");
    createSourcesPanel(document, manifest);
    document.querySelector("#sources-toggle").click();

    expect(document.querySelector("#sources-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("#sources-panel").hidden).toBe(false);
    expect(document.querySelector("#sources-list").textContent).toMatch(
      /Główny Urząd Statystyczny.*2025-12-31.*2026-09-03/s,
    );
    expect(
      [...document.querySelectorAll("#sources-list a")].map(({ href }) => href),
    ).toEqual([
      "https://stat.gov.pl/dataset",
      "https://stat.gov.pl/license",
    ]);
  });
});
