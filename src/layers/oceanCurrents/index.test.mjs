import test from 'node:test';
import assert from 'node:assert/strict';
import { createOceanCurrentsLayer } from './index.js';
import { COLD_COLOR, WARM_COLOR } from './policy.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const line = (id, temp, basin, name = id) => ({
  type: 'Feature',
  id,
  properties: { id, name, temp, basin, rank: 1 },
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [5, 1],
      [10, 2],
      [15, 3],
    ],
  },
});
const fixture = () => ({
  type: 'FeatureCollection',
  meta: { authored: '2026-11-08' },
  features: [
    line('warm-a', 'warm', 'atlantic'),
    line('warm-b', 'warm', 'pacific'),
    line('cold-a', 'cold', 'indian'),
    line('cold-a2', 'cold', 'southern', 'cold-a'),
  ],
});

function harness({ fetch, diagnostics = {}, setCurrentsResult = true } = {}) {
  const fetches = [];
  const calls = [];
  const hostCalls = [];
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['setEntries', ...args]),
    setVisible: (...args) => hostCalls.push(['setVisible', ...args]),
    clearSource: (...args) => hostCalls.push(['clearSource', ...args]),
  };
  const rendering = Object.fromEntries(
    ['start', 'stop', 'clear', 'destroy', 'setOptions'].map((name) => [
      name,
      (...args) => calls.push([name, ...args]),
    ]),
  );
  rendering.setCurrents = (records) => {
    calls.push(['setCurrents', records]);
    return setCurrentsResult;
  };
  rendering.getDiagnostics = () => diagnostics;
  let renderingOptions = null;
  const source = {
    label: 'Fixture',
    fetch:
      fetch ??
      (async (signal) => {
        fetches.push(signal);
        return fixture();
      }),
  };
  const layer = createOceanCurrentsLayer({
    source,
    overlayHost,
    cesium: {},
    createRendering: (options) => {
      renderingOptions = options;
      return rendering;
    },
  });
  const viewer = {
    scene: { requestRender: () => calls.push(['requestRender']) },
  };
  return {
    layer,
    viewer,
    calls,
    fetches,
    hostCalls,
    diagnostics,
    renderingOptions: () => renderingOptions,
    named: (name) => calls.filter(([call]) => call === name),
  };
}

const PROVENANCE =
  'Positions are drawn by hand after textbook maps, not measured flow.';

test('construction validates its collaborators and never fetches', () => {
  assert.throws(
    () => createOceanCurrentsLayer({ overlayHost: {} }),
    /overlay host/,
  );
  assert.throws(
    () =>
      createOceanCurrentsLayer({
        overlayHost: { setEntries() {} },
        source: { label: 'x' },
      }),
    /fetch\(signal\)/,
  );
  const h = harness();
  assert.equal(h.layer.id, 'ocean-currents');
  assert.equal(h.layer.name, 'Ocean currents');
  assert.equal(h.layer.source, 'Fixture');
  assert.equal(h.layer.updateInterval, 0);
  assert.equal(h.layer.statsRefreshInterval, 1000);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.renderingOptions(), null, 'rendering is created at init');
  assert.deepEqual(h.layer.getParams(), { paused: false });
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    loading: false,
    loadingLabel: '',
    error: null,
    warm: 0,
    cold: 0,
    paused: false,
  });
});

test('enable loads once, hands records to rendering and fills the row controls', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  assert.equal(typeof h.renderingOptions().getViewer, 'function');
  assert.equal(h.renderingOptions().getViewer(), h.viewer);
  assert.equal(typeof h.renderingOptions().overlayHost.setEntries, 'function');
  h.layer.enable(h.viewer);
  assert.deepEqual(h.named('start').length, 1);
  assert.equal(h.layer.getStats().loading, true);
  assert.equal(h.layer.getStats().loadingLabel, 'loading...');
  await h.layer.update(h.viewer);
  await settle();
  assert.equal(
    h.fetches.length,
    1,
    'enable and the manager update share one load',
  );
  assert.equal(h.named('setCurrents').length, 1);
  assert.equal(h.named('setCurrents')[0][1].length, 4);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 4);
  assert.equal(stats.loading, false);
  assert.equal(stats.error, null);
  assert.equal(stats.lastUpdate, Date.parse('2026-11-08'));
  assert.equal(stats.warm, 2);
  assert.equal(stats.cold, 1, 'two cold lines share one name');
  await h.layer.update(h.viewer);
  assert.equal(h.fetches.length, 1, 'a loaded layer does not refetch');
  const controls = h.layer.getRowControls();
  assert.equal(controls.chips.length, 1);
  assert.equal(controls.chips[0].id, 'motion');
  assert.equal(controls.chips[0].label, 'Pause');
  assert.equal(controls.chips[0].active, false);
  assert.equal(
    Object.hasOwn(controls.chips[0], 'disabled'),
    false,
    'the chip is never rendered disabled',
  );
  assert.deepEqual(controls.chips[0].params, { paused: true });
  assert.deepEqual(controls.legend, [
    { label: 'Warm currents', color: WARM_COLOR, count: 2 },
    { label: 'Cold currents', color: COLD_COLOR, count: 1 },
  ]);
  assert.equal(
    controls.info,
    `Schematic · 3 major surface currents\n${PROVENANCE}`,
    'provenance is a keyboard-reachable info line, not a hover title',
  );
  assert.match(controls.infoTitle, /Not a forecast/);
  h.layer.destroy();
});

test('pause flows through setParams as a pressed state and notifies the row', async () => {
  const h = harness();
  let notified = 0;
  h.layer.setRowControlsListener(() => notified++);
  h.layer.init(h.viewer);
  assert.deepEqual(h.named('setOptions').at(-1), [
    'setOptions',
    { paused: false },
  ]);
  h.layer.enable(h.viewer);
  await settle();
  h.layer.setParams({ paused: true });
  assert.equal(notified, 1);
  assert.deepEqual(h.named('setOptions').at(-1), [
    'setOptions',
    { paused: true },
  ]);
  assert.deepEqual(h.layer.getParams(), { paused: true });
  assert.equal(h.layer.getStats().paused, true);
  const chip = h.layer.getRowControls().chips[0];
  assert.equal(chip.label, 'Pause', 'the label stays constant');
  assert.equal(chip.active, true, 'pressed state carries the pause');
  assert.deepEqual(chip.params, { paused: false });
  h.layer.setParams({ paused: 'yes' });
  assert.deepEqual(
    h.layer.getParams(),
    { paused: true },
    'non-boolean is ignored',
  );
  assert.equal(notified, 2);
  h.layer.setRowControlsListener(null);
  h.layer.setParams({ paused: false });
  assert.equal(notified, 2);
  h.layer.destroy();
});

test('reduced motion removes the chip and explains itself in the info lines', async () => {
  const h = harness({ diagnostics: { reducedMotion: true } });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await settle();
  const controls = h.layer.getRowControls();
  assert.deepEqual(controls.chips, []);
  assert.equal(
    controls.info,
    `Schematic · 3 major surface currents\n${PROVENANCE}\nAnimation paused by your reduced-motion setting.`,
  );
  assert.deepEqual(h.layer.getDiagnostics(), { reducedMotion: true });
  h.diagnostics.reducedMotion = false;
  assert.equal(h.layer.getRowControls().chips.length, 1);
  h.layer.destroy();
});

test('disable aborts an in-flight load and a late resolve touches nothing', async () => {
  let resolveFetch;
  let signal;
  const h = harness({
    fetch: (abortSignal) => {
      signal = abortSignal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.layer.getStats().loading, true);
  h.layer.disable();
  assert.equal(signal.aborted, true);
  assert.equal(h.layer.getStats().loading, false);
  assert.equal(h.layer.getStats().loadingLabel, '');
  assert.deepEqual(h.named('stop').length, 1);
  assert.deepEqual(h.named('clear').length, 1);
  resolveFetch(fixture());
  await settle();
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(
    h.named('setCurrents').length,
    0,
    'the stale load never reaches rendering',
  );
  assert.equal(h.layer.getStats().error, null);
  h.layer.enable(h.viewer);
  resolveFetch(fixture());
  await settle();
  assert.equal(h.layer.getStats().count, 4, 'a fresh enable loads again');
  assert.equal(h.named('setCurrents').length, 1);
  h.layer.destroy();
});

test('a re-enable rebuilds from cached records without a second fetch', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await settle();
  assert.equal(h.fetches.length, 1);
  h.layer.disable();
  assert.equal(h.layer.getStats().count, 4, 'stats keep the cached count');
  h.layer.enable(h.viewer);
  await settle();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.named('setCurrents').length, 2);
  assert.equal(h.named('start').length, 2);
  h.layer.destroy();
});

test('source and GPU failures surface as English status text', async () => {
  const warn = test.mock.method(console, 'warn', () => {});
  const failing = harness({
    fetch: async () => {
      throw new Error('disk gone');
    },
  });
  failing.layer.init(failing.viewer);
  failing.layer.enable(failing.viewer);
  await settle();
  assert.equal(failing.layer.getStats().error, 'Ocean currents unavailable');
  assert.equal(failing.layer.getStats().loading, false);
  assert.equal(warn.mock.callCount(), 1);
  failing.layer.destroy();
  const malformed = harness({
    fetch: async () => ({ features: [{ type: 'Feature', id: 'nope' }] }),
  });
  malformed.layer.init(malformed.viewer);
  malformed.layer.enable(malformed.viewer);
  await settle();
  assert.equal(malformed.layer.getStats().error, 'Ocean currents unavailable');
  assert.match(warn.mock.calls[1].arguments[1], /Ocean current nope/);
  malformed.layer.destroy();
  const refused = harness({ setCurrentsResult: false });
  refused.layer.init(refused.viewer);
  refused.layer.enable(refused.viewer);
  await settle();
  assert.equal(
    refused.layer.getStats().error,
    'Ocean currents need WebGL polylines',
  );
  assert.equal(refused.layer.getStats().count, 4);
  refused.layer.destroy();
  warn.mock.restore();
});

test('destroy twice is safe and leaves nothing behind', async () => {
  const h = harness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await settle();
  h.layer.destroy();
  h.layer.destroy();
  assert.equal(h.named('destroy').length, 1);
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    lastUpdate: null,
    loading: false,
    loadingLabel: '',
    error: null,
    warm: 0,
    cold: 0,
    paused: false,
  });
  assert.deepEqual(h.layer.getDiagnostics(), {});
  assert.deepEqual(
    h.layer.getRowControls().legend.map(({ count }) => count),
    [0, 0],
  );
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await settle();
  assert.equal(h.fetches.length, 2, 'a destroyed layer may be re-initialised');
  assert.equal(h.layer.getStats().count, 4);
  h.layer.destroy();
});
