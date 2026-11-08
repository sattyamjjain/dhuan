#!/usr/bin/env node
/**
 * qa-ocean — headless check of the two ocean layers and the Map tray against
 * a running dev server (SwiftShader when headless, so numbers are relative):
 *
 *  1. `ocean-currents`: enable, wait for the bundle, read the GPU diagnostics
 *     (32 currents, one primitive per basin, labels published), then pause and
 *     confirm the flow clock stops scheduling frames.
 *  2. `seafloor-features`: enable, wait for the gazetteer (≥ 5,000 features),
 *     read label and plate counts, hide the plates and confirm the PB2002 data
 *     source is hidden.
 *  3. Map tray: open it from the dock, expect six chips, switch to `gebco` and
 *     confirm the active imagery provider is the NCEI GEBCO tile service.
 *
 * Writes `<out>-currents.png`, `<out>-seafloor.png`, `<out>-tray.png` and
 * `<out>-gebco.png`, prints one JSON report, and exits non-zero on any failed
 * expectation.
 *
 * Usage: node scripts/qa-ocean.mjs [--url http://localhost:4173]
 *          [--width 1512 --height 830] [--out qa-ocean] [--chrome /path/to/chrome]
 */
import puppeteer from 'puppeteer';

const argv = process.argv;
const arg = (flag, fallback) =>
  argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const url = arg('--url', 'http://localhost:4173');
const width = Number(arg('--width', 1512));
const height = Number(arg('--height', 830));
const out = arg('--out', 'qa-ocean');
const chrome = arg('--chrome', process.env.PUPPETEER_EXECUTABLE_PATH);

const CURRENTS = 'ocean-currents';
const SEAFLOOR = 'seafloor-features';
const PLATE_SOURCE_NAME = 'PB2002 Plate boundaries';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 300_000,
  ...(chrome ? { executablePath: chrome } : {}),
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), {
    timeout: 120_000,
  });
  await sleep(12_000);
  await page.evaluate(() =>
    document.querySelector('[data-first-run-choice="explore"]')?.click(),
  );
  await sleep(4_000);

  // A clean slate: nothing else enabled, camera parked over the Atlantic at a
  // height where the currents are fully faded in.
  await page.evaluate(async () => {
    const gev = window.__godsEyeView;
    gev.viewer.camera.cancelFlight();
    for (const [id, entry] of gev.dataManager.layers) {
      if (entry.enabled) {
        try {
          await gev.dataManager.setEnabled(id, false, { origin: 'user' });
        } catch {
          /* probe */
        }
      }
    }
    const ellipsoid = gev.viewer.scene.globe.ellipsoid;
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: (-35 * Math.PI) / 180,
        latitude: (20 * Math.PI) / 180,
        height: 14_000_000,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.camera.moveEnd.raiseEvent();
  });
  await sleep(2_000);

  const enable = (id, on) =>
    page.evaluate(
      async (layerId, enabled) => {
        await window.__godsEyeView.dataManager.setEnabled(layerId, enabled, {
          origin: 'user',
        });
      },
      id,
      on,
    );
  const waitForStats = (id, predicate, timeout = 60_000) =>
    page.waitForFunction(
      (layerId, body) => {
        const entry = window.__godsEyeView?.dataManager?.layers?.get(layerId);
        const stats = entry?.module?.getStats?.();
        return stats ? new Function('stats', body)(stats) : false;
      },
      { timeout, polling: 500 },
      id,
      predicate,
    );
  const targets = () =>
    page.evaluate(
      () =>
        document.querySelectorAll('[aria-label="Visible map targets"] button')
          .length,
    );

  // 1. Ocean currents.
  await enable(CURRENTS, true);
  await waitForStats(CURRENTS, 'return stats.count > 0 && !stats.loading');
  await sleep(4_000);
  const currents = await page.evaluate((id) => {
    const entry = window.__godsEyeView.dataManager.layers.get(id);
    return {
      stats: entry.module.getStats(),
      diagnostics: entry.module.getDiagnostics?.() ?? null,
      legend: entry.module
        .getRowControls?.()
        .legend?.map((row) => [row.label, row.count]),
    };
  }, CURRENTS);
  currents.targets = await targets();
  await page.screenshot({ path: `${out}-currents.png` });
  expect(currents.stats.count === 32, `currents count ${currents.stats.count}`);
  expect(
    currents.diagnostics?.currentCount === 32,
    `currents diagnostics currentCount ${currents.diagnostics?.currentCount}`,
  );
  expect(
    currents.diagnostics?.primitiveCount === 4,
    `currents primitiveCount ${currents.diagnostics?.primitiveCount}`,
  );
  expect(
    currents.diagnostics?.labelsShown === true,
    'current labels were not published',
  );
  // Only the near hemisphere publishes; half the schematic faces away.
  expect(currents.targets >= 10, `currents targets ${currents.targets}`);

  await page.evaluate((id) => {
    window.__godsEyeView.dataManager.layers
      .get(id)
      .module.setParams({ paused: true });
  }, CURRENTS);
  await sleep(1_000);
  const paused = await page.evaluate(
    (id) =>
      window.__godsEyeView.dataManager.layers.get(id).module.getDiagnostics(),
    CURRENTS,
  );
  expect(paused.paused === true, 'pause did not reach the renderer');
  expect(paused.framePending === false, 'frames still pending while paused');
  await enable(CURRENTS, false);
  await sleep(1_500);

  // 2. Sea floor features.
  await enable(SEAFLOOR, true);
  await waitForStats(
    SEAFLOOR,
    'return stats.count >= 5000 && !stats.loading',
    90_000,
  );
  await sleep(5_000);
  const seafloor = await page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const entry = gev.dataManager.layers.get(id);
    return {
      stats: entry.module.getStats(),
      params: entry.module.getParams(),
      chips: entry.module
        .getRowControls()
        .chips.map((chip) => [chip.label, chip.active]),
      dataSources: [...Array(gev.viewer.dataSources.length).keys()].map(
        (index) => {
          const source = gev.viewer.dataSources.get(index);
          return [source.name, source.show, source.entities.values.length];
        },
      ),
    };
  }, SEAFLOOR);
  seafloor.targets = await targets();
  await page.screenshot({ path: `${out}-seafloor.png` });
  expect(
    seafloor.stats.count >= 5000,
    `seafloor count ${seafloor.stats.count}`,
  );
  expect(seafloor.stats.plateCount > 0, 'plate segments missing');
  expect(seafloor.stats.labelCount > 0, 'no sea floor labels on screen');
  const plateSource = seafloor.dataSources.find(
    ([name]) => name === PLATE_SOURCE_NAME,
  );
  expect(plateSource?.[1] === true, 'plate source not shown by default');

  await page.evaluate((id) => {
    window.__godsEyeView.dataManager.layers
      .get(id)
      .module.setParams({ plates: false });
  }, SEAFLOOR);
  await sleep(1_000);
  const platesOff = await page.evaluate((name) => {
    const sources = window.__godsEyeView.viewer.dataSources;
    for (let index = 0; index < sources.length; index++) {
      const source = sources.get(index);
      if (source.name === name) return source.show;
    }
    return null;
  }, PLATE_SOURCE_NAME);
  expect(platesOff === false, `plate source still shown: ${platesOff}`);

  // 3. Map tray and the GEBCO stack.
  await page.evaluate(() =>
    document.querySelector('#control-panel-toggle')?.click(),
  );
  await sleep(1_500);
  const tray = await page.evaluate(() => ({
    title: document
      .querySelector('#control-panel .panel-title')
      ?.textContent?.trim(),
    chips: [
      ...document.querySelectorAll('#map-stack-chips .map-stack-chip'),
    ].map((chip) => chip.dataset.stackId),
    visible: Boolean(
      document.querySelector('#control-panel-popover')?.getBoundingClientRect()
        .height,
    ),
  }));
  await page.screenshot({ path: `${out}-tray.png` });
  expect(tray.visible, 'Map tray did not open');
  expect(tray.chips.length === 6, `tray chips ${tray.chips.join(',')}`);
  expect(tray.chips.includes('gebco'), 'gebco chip missing');

  await page.evaluate(() =>
    [...document.querySelectorAll('#map-stack-chips .map-stack-chip')]
      .find((chip) => chip.dataset.stackId === 'gebco')
      ?.click(),
  );
  await page
    .waitForFunction(
      () =>
        window.__godsEyeView?.mapStackController?.getActiveId?.() === 'gebco',
      { timeout: 60_000 },
    )
    .catch(() => {});
  await sleep(10_000);
  const gebco = await page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const layer = gev.viewer.imageryLayers.get(0);
    const provider = layer?.imageryProvider;
    const entry = gev.dataManager.layers.get(id);
    return {
      active: gev.mapStackController.getActiveId(),
      providerUrl: provider?.url ?? provider?._resource?.url ?? null,
      pressed: [
        ...document.querySelectorAll('#map-stack-chips .map-stack-chip'),
      ]
        .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
        .map((chip) => chip.dataset.stackId),
      seafloorChip: entry.module
        .getRowControls()
        .chips.find((chip) => chip.id === 'gebco-map'),
      info: entry.module.getRowControls().info,
    };
  }, SEAFLOOR);
  await page.evaluate(() =>
    document.querySelector('#control-panel-toggle')?.click(),
  );
  await sleep(500);
  await page.screenshot({ path: `${out}-gebco.png` });
  expect(gebco.active === 'gebco', `active stack ${gebco.active}`);
  expect(
    String(gebco.providerUrl).includes('GEBCO_basemap_NCEI'),
    `imagery provider ${gebco.providerUrl}`,
  );
  expect(
    gebco.seafloorChip?.active === true,
    'Sea floor map chip did not read as active',
  );

  const report = {
    viewport: { width, height },
    currents,
    paused: { paused: paused.paused, framePending: paused.framePending },
    seafloor: { ...seafloor, dataSources: undefined },
    platesOff,
    tray,
    gebco,
    pageErrors: pageErrors.slice(0, 5),
    failures,
  };
  console.log(JSON.stringify(report, null, 1));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
