import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const evidenceDirectory = "test-results/evidence";

async function waitForMapRender(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="map"] canvas')].some(
      (canvas) => {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return false;
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let painted = 0;
        for (let offset = 3; offset < pixels.length; offset += 400) {
          if (pixels[offset] > 0 && (painted += 1) > 100) return true;
        }
        return false;
      },
    ),
  );
}

async function selectedCityPixel(page) {
  return page.evaluate(() => {
    const map = document.querySelector('[data-testid="map"]');
    const mapRect = map.getBoundingClientRect();
    const candidates = [];

    for (const canvas of map.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const canvasRect = canvas.getBoundingClientRect();
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const offset = (y * width + x) * 4;
          const [red, green, blue, alpha] = data.slice(offset, offset + 4);
          if (
            alpha > 180 &&
            red >= 75 &&
            red <= 125 &&
            green >= 20 &&
            green <= 65 &&
            blue >= 15 &&
            blue <= 60
          ) {
            candidates.push({
              x: canvasRect.x + (x / width) * canvasRect.width,
              y: canvasRect.y + (y / height) * canvasRect.height,
            });
          }
        }
      }
    }

    if (candidates.length < 4) {
      throw new Error(
        `Nie znaleziono zaznaczonego konturu (${candidates.length} pikseli)`,
      );
    }
    return {
      x: candidates.reduce((sum, point) => sum + point.x, 0) / candidates.length,
      y: candidates.reduce((sum, point) => sum + point.y, 0) / candidates.length,
      map: {
        left: mapRect.left,
        top: mapRect.top,
        right: mapRect.right,
        bottom: mapRect.bottom,
      },
    };
  });
}

async function renderedColorSample(page, mode, near) {
  return page.evaluate(({ mode, near }) => {
    const map = document.querySelector('[data-testid="map"]');
    const candidates = [];
    for (const canvas of map.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const rect = canvas.getBoundingClientRect();
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const offset = (y * width + x) * 4;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          const alpha = data[offset + 3];
          const matches =
            mode === "red"
              ? alpha > 120 &&
                red >= 115 && red <= 155 &&
                green >= 35 && green <= 85 &&
                blue >= 25 && blue <= 75
              : alpha > 120 &&
                red <= 55 &&
                green >= 65 && green <= 145 &&
                blue >= 65 && blue <= 150;
          if (!matches) continue;
          const point = {
            x: rect.x + (x / width) * rect.width,
            y: rect.y + (y / height) * rect.height,
          };
          if (
            !near ||
            Math.hypot(point.x - near.x, point.y - near.y) <= near.radius
          ) {
            candidates.push(point);
          }
        }
      }
    }
    return {
      count: candidates.length,
      x:
        candidates.reduce((sum, point) => sum + point.x, 0) /
        Math.max(candidates.length, 1),
      y:
        candidates.reduce((sum, point) => sum + point.y, 0) /
        Math.max(candidates.length, 1),
    };
  }, { mode, near });
}

async function countryRenderedBounds(page) {
  return page.evaluate(() => {
    const map = document.querySelector('[data-testid="map"]');
    const points = [];
    for (const canvas of map.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const rect = canvas.getBoundingClientRect();
      for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
          const offset = (y * width + x) * 4;
          const [red, green, blue, alpha] = data.slice(offset, offset + 4);
          if (
            alpha > 200 &&
            red >= 225 && red <= 248 &&
            green >= 220 && green <= 245 &&
            blue >= 205 && blue <= 232
          ) {
            points.push({
              x: rect.x + (x / width) * rect.width,
              y: rect.y + (y / height) * rect.height,
            });
          }
        }
      }
    }
    if (points.length < 100) {
      throw new Error(`Za mało pikseli Polski: ${points.length}`);
    }
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  });
}

async function physicalDrag(page, start, target) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true });
});

test("porównuje Lublin przez drag, obrót i Reset bez zewnętrznej sieci", async ({
  page,
}) => {
  const foreignRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173") foreignRequests.push(url.href);
  });

  await page.goto("/");
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator(".city-button")).toHaveCount(30);
  await expect(page.locator("#results-count")).toHaveText("30 z 30 miast");
  await waitForMapRender(page);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: `${evidenceDirectory}/initial-poland.png`,
    fullPage: true,
  });

  const search = page.getByRole("searchbox", { name: "Znajdź miasto" });
  await search.fill("Lublin");
  await expect(page.locator(".city-button")).toHaveCount(1);
  await expect(page.locator("#results-count")).toHaveText("1 z 30 miast");
  await search.fill("");
  await expect(page.locator(".city-button")).toHaveCount(30);

  await page.getByRole("button", { name: /8\. Lublin/ }).click();
  await page.waitForTimeout(450);
  const start = await selectedCityPixel(page);
  const target = {
    x: Math.min(start.x + 150, start.map.right - 80),
    y: Math.min(start.y + 110, start.map.bottom - 80),
  };
  await physicalDrag(page, start, target);

  await expect(page.locator("#copy-count")).toHaveText("1");
  await expect(page.locator("#selection-controls")).toBeVisible();

  const firstCopy = await renderedColorSample(page, "turquoise");
  expect(firstCopy.count).toBeGreaterThan(3);
  await physicalDrag(page, firstCopy, {
    x: Math.min(firstCopy.x + 90, start.map.right - 70),
    y: Math.max(firstCopy.y - 60, start.map.top + 70),
  });
  await expect(page.locator("#copy-count")).toHaveText("1");
  const movedCopy = await renderedColorSample(page, "turquoise");
  expect(Math.hypot(movedCopy.x - firstCopy.x, movedCopy.y - firstCopy.y))
    .toBeGreaterThan(35);

  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#live-region")).toContainText("Wybrano Lublin");
  await page.waitForTimeout(450);
  const secondStart = await selectedCityPixel(page);
  expect(Math.hypot(secondStart.x - start.x, secondStart.y - start.y))
    .toBeLessThanOrEqual(8);
  await physicalDrag(page, secondStart, {
    x: Math.min(secondStart.x + 110, secondStart.map.right - 70),
    y: Math.max(secondStart.y - 90, secondStart.map.top + 70),
  });
  await expect(page.locator("#copy-count")).toHaveText("2");

  const slider = page.getByTestId("rotation-slider");
  await slider.fill("30");
  await expect(page.locator("#angle-output")).toHaveText("30°");
  await page.keyboard.press("]");
  await expect(page.locator("#angle-output")).toHaveText("31°");
  await page.keyboard.press("Shift+]");
  await expect(page.locator("#angle-output")).toHaveText("46°");
  const beforeCenter = await renderedColorSample(page, "turquoise");
  await page.getByRole("button", { name: "Wyśrodkuj" }).click();
  await page.waitForTimeout(450);
  const afterCenter = await renderedColorSample(page, "turquoise");
  expect(Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y))
    .toBeGreaterThan(15);
  expect(afterCenter.x).toBeGreaterThan(650);
  expect(afterCenter.x).toBeLessThan(950);
  expect(afterCenter.y).toBeGreaterThan(250);
  expect(afterCenter.y).toBeLessThan(550);

  await page.getByRole("button", { name: "Usuń kopię" }).click();
  await expect(page.locator("#copy-count")).toHaveText("1");
  await expect(page.locator("#selection-controls")).toBeHidden();
  await page.screenshot({
    path: `${evidenceDirectory}/lublin-copy-rotated.png`,
    fullPage: true,
  });

  await page.getByTestId("reset").click();
  await expect(page.locator("#copy-count")).toHaveText("0");
  await expect(page.locator("#selection-controls")).toBeHidden();
  await expect(search).toHaveValue("");
  await expect(page.locator("#results-count")).toHaveText("30 z 30 miast");
  await page.waitForTimeout(450);
  const resetCountryBounds = await countryRenderedBounds(page);
  expect(resetCountryBounds.right - resetCountryBounds.left).toBeGreaterThan(620);
  expect(resetCountryBounds.right - resetCountryBounds.left).toBeLessThan(800);
  expect(resetCountryBounds.bottom - resetCountryBounds.top).toBeGreaterThan(600);
  expect(resetCountryBounds.top).toBeLessThan(100);
  expect(resetCountryBounds.bottom).toBeGreaterThan(700);

  const panelToggle = page.locator("#panel-toggle");
  await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
  await panelToggle.click();
  await expect(panelToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Źródła danych" })).toBeVisible();
  await page.getByRole("button", { name: "Źródła danych" }).click();
  await expect(page.locator("#sources-panel")).toBeVisible();
  await expect(page.locator("#sources-list article")).toHaveCount(2);
  expect(foreignRequests).toEqual([]);
});

test("zachowuje używalny panel mobilny", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator("#city-panel")).toBeVisible();
  await expect(page.getByTestId("map")).toBeVisible();
  await expect(page.getByTestId("reset")).toBeVisible();
  await waitForMapRender(page);
  const search = page.getByRole("searchbox", { name: "Znajdź miasto" });
  await search.fill("Łódź");
  await expect(page.locator(".city-button")).toHaveCount(1);
  await expect(page.locator("#results-count")).toHaveText("1 z 30 miast");
  await search.fill("miasto-którego-nie-ma");
  await expect(page.locator(".city-button")).toHaveCount(0);
  await expect(page.locator("#zero-results")).toBeVisible();
  await expect(page.locator("#zero-results")).toContainText("Nie znaleziono miasta");

  const layout = await page.evaluate(() => {
    const map = document.querySelector('[data-testid="map"]').getBoundingClientRect();
    const panel = document.querySelector("#city-panel").getBoundingClientRect();
    return {
      visibleMapHeight: panel.top - map.top,
      panelInsideMap: panel.bottom <= map.bottom && panel.left >= map.left,
    };
  });
  expect(layout.visibleMapHeight).toBeGreaterThan(350);
  expect(layout.panelInsideMap).toBe(true);
  await page.screenshot({
    path: `${evidenceDirectory}/mobile-atlas.png`,
    fullPage: true,
  });
});
