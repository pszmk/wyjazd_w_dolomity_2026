#!/usr/bin/env node
/**
 * Capture route map screenshots from official tourism pages.
 * Run: node scripts/capture-route-maps.mjs
 */
import { chromium } from 'playwright';
import { mkdir, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

/** @type {Array<{file:string, url:string, source:string, fallbackUrl?:string, mapMode?:'trentino'|'gardatrentino'|'valgardena'|'outdooractive'|'pustertal'|'visitlakeiseo'}>} */
const routes = [
  {
    file: 'version-a/assets/maps/gran-cir.png',
    url: 'https://www.valgardena.it/en/outdoor/base/outdoor/gran-cir-gran-cir-peak/810054754/',
    source: 'Val Gardena',
    mapMode: 'valgardena',
  },
  {
    file: 'version-a/assets/maps/seceda.png',
    url: 'https://outdoor.valgardena.it/en/route/hiking-trail/seceda-ridge-line-from-ortisei/810055445/',
    source: 'Val Gardena Outdoor',
    mapMode: 'valgardena',
    fallbackUrl: 'https://www.valgardena.it/en/outdoor/base/outdoor/seceda/810054755/',
  },
  {
    file: 'version-a/assets/maps/ra-gusela.png',
    url: 'https://www.outdooractive.com/en/route/via-ferrata/ampezzaner-dolomiten/30.-via-ferrata-ra-gusela-nuvolau-2574-m-/58456823/',
    source: 'Outdooractive',
    mapMode: 'outdooractive',
  },
  {
    file: 'version-a/assets/maps/tre-cime.png',
    url: 'https://www.pustertal.org/en/leisure-activities/mountains-and-hiking/hiking-in-alta-pusteria-three-peaks/tre-cime-di-lavaredo-circular-hike/',
    source: 'Pustertal',
    mapMode: 'pustertal',
    fallbackUrl: 'https://auronzo.info/en/tre-cime-di-lavaredo-dolomites/',
  },
  {
    file: 'version-b/assets/maps/busatte-tempesta.png',
    url: 'https://www.visittrentino.info/en/guide/tour/sentiero-busatte-tempesta_tour_1553752',
    source: 'Visit Trentino',
    mapMode: 'trentino',
  },
  {
    file: 'version-b/assets/maps/punta-larici.png',
    url: 'https://www.gardatrentino.it/en/activity/punta-larici-the-most-spectacular-lookout-point-on-lake-garda_8491',
    source: 'Garda Trentino',
    mapMode: 'gardatrentino',
  },
  {
    file: 'version-b/assets/maps/castel-toblino.png',
    url: 'https://www.gardatrentino.it/en/activity/covelo-bait-del-germano_45307',
    source: 'Garda Trentino',
    mapMode: 'gardatrentino',
  },
  {
    file: 'version-b/assets/maps/colodri.png',
    url: 'https://www.visittrentino.info/en/guide/tour/via-ferrata-colodri-colt_tour_8279464',
    source: 'Visit Trentino',
    mapMode: 'trentino',
  },
  {
    file: 'version-b/assets/maps/monte-isola-ceriola.png',
    url: 'https://visitlakeiseo.info/en/sport-and-adventure/trekking-from-peschiera-maraglio-to-the-ceriola-sanctuary/',
    source: 'Visit Lake Iseo',
    mapMode: 'visitlakeiseo',
  },
];

async function acceptCookies(page) {
  for (const sel of [
    'button:has-text("Accept all")',
    'button:has-text("Allow all")',
    'button:has-text("Accetta tutti")',
    '#onetrust-accept-btn-handler',
    '[data-testid="uc-accept-all-button"]',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1200 })) {
        await btn.click();
        await page.waitForTimeout(600);
        return;
      }
    } catch {
      /* next */
    }
  }
}

async function closeNewsletter(page) {
  for (const sel of [
    'button:has-text("Close")',
    'button[aria-label="Close"]',
    '.modal button.close',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      /* next */
    }
  }
}

async function waitForMapTiles(page) {
  await page.waitForTimeout(2500);
  try {
    await page.waitForFunction(() => {
      const tiles = document.querySelectorAll('.leaflet-tile-loaded, .mapboxgl-canvas, canvas');
      if (tiles.length === 0) return false;
      for (const t of tiles) {
        const r = t.getBoundingClientRect();
        if (r.width > 200 && r.height > 200) return true;
      }
      return document.querySelectorAll('.leaflet-tile-loaded').length >= 4;
    }, { timeout: 20000 });
  } catch {
    await page.waitForTimeout(4000);
  }
}

async function screenshotMap(page, outPath, mapMode) {
  const candidates = [
    '.leaflet-container',
    '.oax-route-map .leaflet-container',
    '.oax-route-map',
    '[class*="route-map"] .leaflet-container',
    '[class*="RouteMap"]',
    '.map-container .leaflet-container',
  ];

  if (mapMode === 'trentino' || mapMode === 'valgardena') {
    try {
      const enlarge = page.getByRole('button', { name: /enlarge map/i });
      if (await enlarge.isVisible({ timeout: 3000 })) {
        await enlarge.click();
        await page.waitForTimeout(1500);
      }
    } catch {
      /* map may already be expanded */
    }
  }

  await waitForMapTiles(page);

  for (const sel of candidates) {
    const loc = page.locator(sel);
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      try {
        if (!(await el.isVisible({ timeout: 1000 }))) continue;
        const box = await el.boundingBox();
        if (!box || box.width < 350 || box.height < 250) continue;
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await el.screenshot({ path: outPath });
        const { size } = await stat(outPath);
        if (size > 15000) return true;
      } catch {
        /* try next */
      }
    }
  }

  await page.screenshot({ path: outPath, fullPage: false });
  return true;
}

async function captureRoute(browser, route) {
  const outPath = path.join(root, route.file);
  await mkdir(path.dirname(outPath), { recursive: true });

  for (const url of [route.url, route.fallbackUrl].filter(Boolean)) {
    const page = await browser.newPage();
    page.setViewportSize({ width: 1400, height: 1000 });
    const target = route.mapMode === 'trentino' ? `${url}#dm=1` : url;
    try {
      console.log(`Capturing ${route.file} from ${target}`);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await acceptCookies(page);
      await closeNewsletter(page);
      await page.waitForTimeout(1500);

      if (route.mapMode === 'gardatrentino') {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(1000);
      }

      if (route.mapMode === 'pustertal') {
        try {
          const openMap = page.locator('a, button').filter({ hasText: /open map/i }).first();
          if (await openMap.isVisible({ timeout: 3000 })) {
            await openMap.click();
            await page.waitForTimeout(3000);
          }
        } catch {
          /* map may already be open */
        }
      }

      await screenshotMap(page, outPath, route.mapMode);
      const { size } = await stat(outPath);
      console.log(`  ✓ ${route.file} (${Math.round(size / 1024)} KB)`);
      await page.close();
      return size > 15000;
    } catch (err) {
      console.error(`  ✗ failed ${url}: ${err.message}`);
      await page.close();
    }
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let ok = 0;
  for (const route of routes) {
    if (await captureRoute(browser, route)) ok++;
  }
  await browser.close();
  console.log(`\nDone: ${ok}/${routes.length} maps captured.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
