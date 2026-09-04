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
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator("#copy-count")).toHaveText("1");
  await expect(page.locator("#selection-controls")).toBeVisible();
  const slider = page.getByTestId("rotation-slider");
  await slider.fill("30");
  await expect(page.locator("#angle-output")).toHaveText("30°");
  await page.keyboard.press("]");
  await expect(page.locator("#angle-output")).toHaveText("31°");
  await page.keyboard.press("Shift+]");
  await expect(page.locator("#angle-output")).toHaveText("46°");
  await page.screenshot({
    path: `${evidenceDirectory}/lublin-copy-rotated.png`,
    fullPage: true,
  });

  await page.getByTestId("reset").click();
  await expect(page.locator("#copy-count")).toHaveText("0");
  await expect(page.locator("#selection-controls")).toBeHidden();
  await expect(search).toHaveValue("");
  await expect(page.locator("#results-count")).toHaveText("30 z 30 miast");
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
  await page.screenshot({
    path: `${evidenceDirectory}/mobile-atlas.png`,
    fullPage: true,
  });
});
