import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSeafloorFeaturesLayer } from './index.js';
import { SEAFLOOR_LAYER_ID } from './policy.js';

/** A tiny bundle in the shipped schema, all in the Atlantic under the camera. */
/**
 * Extra major features (rank-2 ridges) on a grid around the camera, to push
 * the global label budget (80) past its cap.
 */
function extraRidges(count) {
  return Array.from({ length: count }, (_, i) => ({
    n: `Grid ${i}`,
    t: 'Ridge',
    k: 'major',
    r: 2,
    g: 'p',
    a: [-40 + (i % 10) * 0.5, 35 + Math.floor(i / 10) * 0.5],
  }));
}

function fixtureBundle({ extraMajors = 0 } = {}) {
  return {
    features: {
      meta: { counts: { point: 1, line: 1, polygon: 2 } },
      features: [
        {
          n: 'Mariana',
          t: 'Trench',
          k: 'major',
          r: 1,
          g: 'l',
          a: [-30, 30],
          c: [
            [
              [-31, 29],
              [-30, 30],
              [-29, 31],
            ],
          ],
        },
        {
          n: 'Sohm',
          t: 'Basin',
          k: 'major',
          r: 7,
          g: 'y',
          a: [-45, 40],
          c: [
            [
              [-46, 39],
              [-44, 39],
              [-44, 41],
              [-46, 41],
              [-46, 39],
            ],
          ],
        },
        {
          n: 'Satsuma',
          t: 'Seamounts',
          k: 'minor',
          r: 10,
          g: 'p',
          a: [-35, 33],
        },
        {
          n: 'Gageo',
          t: 'Reef',
          k: 'minor',
          r: 18,
          g: 'y',
          a: [-36, 34],
          c: [
            [
              [-36.1, 33.9],
              [-35.9, 33.9],
              [-35.9, 34.1],
              [-36.1, 33.9],
            ],
          ],
        },
        ...extraRidges(extraMajors),
      ],
    },
    plates: {
      meta: { classes: { OSR: 1, SUB: 1, OTF: 0 }, segments: 2 },
      segments: [
        {
          c: 'OSR',
          p: 'NA-EU',
          v: [
            [-30, 20],
            [-28, 25],
          ],
        },
        {
          c: 'SUB',
          p: 'NA-CA',
          v: [
            [-60, 15],
            [-62, 18],
          ],
        },
      ],
    },
  };
}

function makeStubViewer(listeners, dataSources, picks) {
  return {
    dataSources: {
      add: (source) =>
        new Promise((resolve) => {
          Promise.resolve().then(() => {
            dataSources.push(source);
            resolve(source);
          });
        }),
      remove: (source) => {
        const index = dataSources.indexOf(source);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-40, 35, 4_500_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd: {
        addEventListener: (fn) => {
          listeners.moveEnd.add(fn);
          return () => listeners.moveEnd.delete(fn);
        },
      },
      cancelFlight() {},
      flyTo() {
        throw new Error('the sea floor layer never flies the camera');
      },
    },
    scene: {
      canvas: { clientHeight: 900 },
      globe: { show: true },
      requestRender() {},
      pick() {
        return picks.next;
      },
      preRender: {
        addEventListener: (fn) => {
          listeners.preRender.add(fn);
          return () => listeners.preRender.delete(fn);
        },
      },
    },
  };
}

function createHarness({ withMapStack = true, extraMajors = 0 } = {}) {
  const hostCalls = [];
  const listeners = { preRender: new Set(), moveEnd: new Set() };
  const dataSources = [];
  const picks = { next: null };
  const contexts = new Map();
  const calls = {
    selected: [],
    removed: [],
    cleared: [],
    mapStack: [],
    handlers: [],
    destroyedHandlers: 0,
    rowControls: 0,
  };
  const mapStackEventTarget = new EventTarget();
  const layer = createSeafloorFeaturesLayer({
    source: {
      label: 'Fixture',
      async fetch() {
        return fixtureBundle({ extraMajors });
      },
    },
    overlayHost: {
      setVisible: (...args) => hostCalls.push(['visible', ...args]),
      setEntries: (...args) => hostCalls.push(['entries', ...args]),
      clearSource: (...args) => hostCalls.push(['clear', ...args]),
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(handler, type) {
        calls.handlers.push({ handler, type });
      },
      destroy() {
        calls.destroyedHandlers++;
      },
    }),
    registerEntityContext: (entity, metadata) => {
      entity.__gevContextId = metadata.id;
      contexts.set(metadata.id, { ...metadata, entity });
      return contexts.get(metadata.id);
    },
    selectEntityContext: (entity) => {
      calls.selected.push(entity?.__gevContextId);
      return contexts.get(entity?.__gevContextId) || null;
    },
    removeEntityContextsForLayer: (layerId) => {
      calls.removed.push(layerId);
      for (const [id, record] of contexts)
        if (record.layerId === layerId) contexts.delete(id);
    },
    clearSelectedEntityContextForLayer: (layerId) =>
      calls.cleared.push(layerId),
    mapStackEventTarget,
    requestMapStack: withMapStack
      ? (id) => {
          calls.mapStack.push(id);
        }
      : null,
    sweepClock: () => 0,
  });
  layer.setRowControlsListener(() => {
    calls.rowControls++;
  });
  const viewer = makeStubViewer(listeners, dataSources, picks);
  layer.init(viewer);
  return {
    layer,
    viewer,
    hostCalls,
    dataSources,
    picks,
    contexts,
    calls,
    mapStackEventTarget,
    raiseSweep() {
      for (const fn of listeners.preRender) fn();
    },
    publishedTitles() {
      const last = hostCalls.filter((call) => call[0] === 'entries').at(-1);
      return last ? last[2].map((entry) => entry.title).sort() : null;
    },
    async settle() {
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

test('enable loads both sources, counts the features and names the plates', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  assert.equal(env.layer.getStats().loading, true);
  await env.settle();
  const stats = env.layer.getStats();
  assert.equal(stats.loading, false);
  assert.equal(stats.error, null);
  assert.equal(stats.count, 4);
  assert.equal(stats.plateCount, 2);
  assert.deepEqual(
    env.dataSources.map((source) => source.name),
    ['GEBCO Sea floor features', 'PB2002 Plate boundaries'],
  );
  const [features, plates] = env.dataSources;
  assert.equal(features.show, true);
  assert.equal(plates.show, true);
  // 4 anchors + 1 trench line + 1 basin outline; the minor reef draws no ring.
  assert.equal(features.entities.values.length, 6);
  assert.equal(plates.entities.values.length, 2);
  for (const entity of features.entities.values) {
    if (entity.point) {
      assert.equal(
        entity.point.disableDepthTestDistance.getValue(),
        Number.POSITIVE_INFINITY,
      );
      assert.equal(entity.polyline, undefined, 'anchors carry no stem');
    } else {
      assert.equal(entity.polyline.clampToGround.getValue(), true);
    }
  }
  assert.equal(env.contexts.size, 4);
  assert.equal(
    env.contexts.get(`${SEAFLOOR_LAYER_ID}:0`).label,
    'Mariana Trench',
  );
  assert.equal(
    env.contexts.get(`${SEAFLOOR_LAYER_ID}:0`).layerId,
    SEAFLOOR_LAYER_ID,
  );
  assert.ok(env.calls.rowControls >= 1, 'load completion refreshes the row');
});

test('the sweep publishes major labels from global framing and minor ones only with Names: all', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  await env.settle();
  env.raiseSweep();
  assert.deepEqual(env.publishedTitles(), ['Mariana Trench', 'Sohm Basin']);
  assert.equal(env.layer.getStats().labelCount, 2);
  const seamount = env.dataSources[0].entities.getById('seafloor-2');
  assert.equal(seamount.show, false, 'minor anchors hide above 2,500 km');
  env.raiseSweep();
  assert.equal(
    env.hostCalls.filter((call) => call[0] === 'entries').length,
    1,
    'a parked camera does not republish an identical cohort',
  );
  env.layer.setParams({ names: 'all' });
  assert.equal(env.layer.getParams().names, 'all');
  env.raiseSweep();
  assert.deepEqual(env.publishedTitles(), [
    'Gageo Reef',
    'Mariana Trench',
    'Satsuma Seamounts',
    'Sohm Basin',
  ]);
  assert.equal(seamount.show, true);
});

test('at global framing only the named anchors show; below 3,000 km every major anchor returns', async () => {
  const env = createHarness({ extraMajors: 90 });
  env.layer.enable(env.viewer);
  await env.settle();
  env.raiseSweep();
  const features = env.dataSources[0].entities;
  const anchors = features.values.filter((entity) => entity.point);
  assert.equal(anchors.length, 94);
  // 92 majors under a 4,500 km camera, an 80-label budget: 80 named dots.
  assert.equal(env.layer.getStats().labelCount, 80);
  const shown = anchors.filter((entity) => entity.show);
  assert.equal(shown.length, 80, 'only the named anchors stay visible');
  assert.equal(features.getById('seafloor-0').show, true, 'rank 1 trench');
  assert.equal(
    features.getById('seafloor-1').show,
    false,
    'the rank-7 basin lost the budget to the ridges, so its dot hides too',
  );
  env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(
    -40,
    35,
    2_000_000,
  );
  env.raiseSweep();
  // Under 3,000 km the budget is 200 and the minor gate opens: every anchor.
  assert.equal(anchors.filter((entity) => entity.show).length, 94);
  assert.equal(env.layer.getStats().labelCount, 94);
});

test('setParams toggles the plate source and the chips, legend and counts follow', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  await env.settle();
  const before = env.calls.rowControls;
  assert.equal(env.layer.setParams({ plates: false }), true);
  assert.equal(env.dataSources[1].show, false);
  assert.equal(env.layer.getParams().plates, false);
  assert.equal(env.calls.rowControls, before + 1);
  let controls = env.layer.getRowControls();
  assert.deepEqual(
    controls.chips.map((chip) => chip.id),
    ['plates', 'names-major', 'names-all', 'gebco-map'],
  );
  assert.equal(controls.chips[0].active, false);
  assert.deepEqual(controls.chips[0].params, { plates: true });
  assert.deepEqual(
    controls.chips.slice(1, 3).map((chip) => [chip.label, chip.active]),
    [
      ['Major names', true],
      ['All names', false],
    ],
    'each names mode is its own chip; the active one is the current mode',
  );
  assert.deepEqual(controls.chips[1].params, { names: 'major' });
  assert.deepEqual(controls.chips[2].params, { names: 'all' });
  assert.equal(controls.legend.length, 8, 'plate rows leave with the plates');
  assert.ok(
    controls.legend.every((row) => row.blurb === undefined),
    'legend rows carry label, colour and count only',
  );
  assert.match(controls.info, /IHO-IOC GEBCO Gazetteer/);
  assert.match(controls.info, /^0 names on screen$/m, 'before any sweep');
  assert.doesNotMatch(controls.info, /Basemap/);
  assert.deepEqual(
    controls.legend.map((row) => row.count),
    [1, 0, 1, 0, 0, 2, 0, 0],
  );
  env.raiseSweep();
  assert.match(env.layer.getRowControls().info, /^2 names on screen$/m);
  env.layer.setParams({ plates: true, names: 'bogus' });
  assert.equal(env.dataSources[1].show, true);
  assert.equal(env.layer.getParams().names, 'major');
  controls = env.layer.getRowControls();
  assert.equal(controls.legend.length, 11);
  assert.deepEqual(
    controls.legend.slice(8).map((row) => row.count),
    [1, 1, 0],
  );
  assert.equal(
    env.layer.setParams({ plates: true }),
    true,
    'a no-op still succeeds',
  );
});

test('the Sea floor map chip asks for gebco, reads busy until the shell answers, and returns to the stack it left', async () => {
  const env = createHarness();
  const gebcoChip = () =>
    env.layer.getRowControls().chips.find((c) => c.id === 'gebco-map');
  env.mapStackEventTarget.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'osm' } }),
  );
  assert.equal(gebcoChip().active, false);
  assert.equal(gebcoChip().busy, false);
  gebcoChip().onClick();
  assert.deepEqual(env.calls.mapStack, ['gebco']);
  assert.equal(
    gebcoChip().active,
    false,
    'active follows the event, not the click',
  );
  assert.equal(gebcoChip().busy, true);
  env.mapStackEventTarget.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'gebco' } }),
  );
  assert.equal(gebcoChip().active, true);
  assert.equal(gebcoChip().busy, false);
  assert.match(env.layer.getRowControls().info, /^Basemap: GEBCO sea floor$/m);
  gebcoChip().onClick();
  assert.deepEqual(env.calls.mapStack, ['gebco', 'osm']);
  env.mapStackEventTarget.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'osm' } }),
  );
  assert.doesNotMatch(env.layer.getRowControls().info, /Basemap/);
  env.layer.enable(env.viewer);
  await env.settle();
  env.layer.disable();
  assert.deepEqual(
    env.calls.mapStack,
    ['gebco', 'osm'],
    'disabling the layer never touches the basemap',
  );
  env.layer.destroy(env.viewer);
  const bare = createHarness({ withMapStack: false });
  assert.deepEqual(
    bare.layer.getRowControls().chips.map((c) => c.id),
    ['plates', 'names-major', 'names-all'],
    'no request lane, no chip',
  );
});

test('published labels carry an accessible name and an activator that selects the feature', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  await env.settle();
  env.raiseSweep();
  const entries = env.hostCalls
    .filter((call) => call[0] === 'entries')
    .at(-1)[2];
  assert.deepEqual(entries.map((entry) => entry.accessibilityLabel).sort(), [
    'Mariana Trench, trench',
    'Sohm Basin, basin',
  ]);
  for (const entry of entries) {
    assert.equal(entry.interactive, true);
    assert.equal(typeof entry.activate, 'function');
  }
  const trench = entries.find((entry) => entry.title === 'Mariana Trench');
  assert.equal(trench.activate(), true);
  assert.deepEqual(env.calls.selected, [`${SEAFLOOR_LAYER_ID}:0`]);
  env.layer.disable();
  assert.equal(
    trench.activate(),
    false,
    'a disabled layer declines activation',
  );
  assert.equal(env.calls.selected.length, 1);
});

test('a click selects the registered context of an anchor or a line and never flies', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  await env.settle();
  const click = env.calls.handlers.find(
    (entry) => entry.type === Cesium.ScreenSpaceEventType.LEFT_CLICK,
  );
  assert.ok(click, 'a LEFT_CLICK handler is bound');
  const features = env.dataSources[0];
  env.picks.next = { id: features.entities.getById('seafloor-2') };
  click.handler({ position: { x: 1, y: 1 } });
  env.picks.next = { id: features.entities.getById('seafloor-0-path-0') };
  click.handler({ position: { x: 1, y: 1 } });
  env.picks.next = null;
  click.handler({ position: { x: 1, y: 1 } });
  assert.deepEqual(env.calls.selected, [
    `${SEAFLOOR_LAYER_ID}:2`,
    `${SEAFLOOR_LAYER_ID}:0`,
  ]);
  env.layer.disable();
  env.picks.next = { id: features.entities.getById('seafloor-2') };
  click.handler({ position: { x: 1, y: 1 } });
  assert.equal(env.calls.selected.length, 2, 'disabled layers ignore clicks');
});

test('disable releases the sources and contexts; destroy clears selection and listeners', async () => {
  const env = createHarness();
  env.layer.enable(env.viewer);
  await env.settle();
  env.raiseSweep();
  env.layer.disable();
  assert.deepEqual(env.dataSources, []);
  assert.deepEqual(env.calls.removed, [SEAFLOOR_LAYER_ID]);
  assert.equal(env.contexts.size, 0);
  assert.equal(env.layer.getStats().count, 4, 'the count survives a disable');
  assert.ok(
    env.hostCalls.some((call) => call[0] === 'clear'),
    'hide clears the published labels',
  );
  env.layer.enable(env.viewer);
  await env.settle();
  assert.equal(
    env.dataSources.length,
    2,
    're-enable rebuilds from the cached bundle',
  );
  assert.equal(env.contexts.size, 4);
  env.layer.destroy(env.viewer);
  assert.deepEqual(env.dataSources, []);
  assert.ok(env.calls.cleared.includes(SEAFLOOR_LAYER_ID));
  assert.equal(env.calls.destroyedHandlers, 1);
  assert.equal(env.layer.getStats().count, 0);
  env.mapStackEventTarget.dispatchEvent(
    new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'gebco' } }),
  );
  assert.equal(
    env.layer.getRowControls().chips.find((c) => c.id === 'gebco-map').active,
    false,
    'the map-stack listener is gone after destroy',
  );
});

test('a source without a label or fetch, or a missing host, is rejected up front', () => {
  assert.throws(
    () =>
      createSeafloorFeaturesLayer({
        source: {},
        overlayHost: { setEntries() {} },
      }),
    /label and fetch/,
  );
  assert.throws(
    () =>
      createSeafloorFeaturesLayer({
        source: { label: 'x', fetch: async () => ({}) },
      }),
    /overlay host/,
  );
});
