import test from 'node:test';
import assert from 'node:assert/strict';
import { createOceanCurrentRendering } from './rendering.js';
import {
  ACTIVATE_FLIGHT_SECONDS,
  ACTIVATE_HEIGHT_METERS,
  OVERLAY_SOURCE_ID,
} from './policy.js';

const records = () => [
  { id: 'a', name: 'A', temp: 'warm', rank: 1, reference: [0, 0] },
  { id: 'b', name: 'B', temp: 'cold', rank: 2, reference: [10, 10] },
];

function harness({ supported = true, flyTo = true } = {}) {
  const gpuCalls = [];
  const gpuState = { heightFade: 1, visible: true, ready: true };
  const gpu = {
    supported: () => supported,
    setCurrents(list) {
      gpuCalls.push(['setCurrents', list.length]);
      return supported;
    },
    updateVisibility() {
      gpuCalls.push(['updateVisibility']);
      return gpuState.visible;
    },
    tick: (time) => gpuCalls.push(['tick', time]),
    setOptions: (options) => gpuCalls.push(['setOptions', options.paused]),
    clear: () => gpuCalls.push(['clear']),
    destroy: () => gpuCalls.push(['destroy']),
    getDiagnostics: () => ({
      heightFade: gpuState.heightFade,
      ready: gpuState.ready,
      primitiveCount: 2,
    }),
  };
  const hostCalls = [];
  const published = { entries: [] };
  const overlayHost = {
    setEntries(id, entries) {
      hostCalls.push(['setEntries', id, entries.length]);
      published.entries = entries;
    },
    setVisible: (...args) => hostCalls.push(['setVisible', ...args]),
    clearSource: (...args) => hostCalls.push(['clearSource', ...args]),
  };
  const clock = { running: false, pending: false, canRun: null, onFrame: null };
  const fakeClock = {
    start: () => (clock.running = true),
    stop() {
      clock.running = false;
      clock.pending = false;
    },
    poke: () => (clock.pending = clock.running && clock.canRun()),
    isPending: () => clock.pending,
    getFlowTime: () => 0,
    reset: () => gpuCalls.push(['clockReset']),
  };
  const sceneListeners = { preRender: [], moveEnd: [] };
  const subscribe = (list) => ({
    addEventListener(callback) {
      list.push(callback);
      return () => list.splice(list.indexOf(callback), 1);
    },
  });
  const renders = [];
  const flights = [];
  const viewer = {
    scene: {
      requestRender: () => renders.push(1),
      preRender: subscribe(sceneListeners.preRender),
      camera: { moveEnd: subscribe(sceneListeners.moveEnd) },
    },
    camera: flyTo ? { flyTo: (options) => flights.push(options) } : {},
  };
  const media = {
    matches: false,
    listeners: [],
    addEventListener(_, callback) {
      this.listeners.push(callback);
    },
    removeEventListener(_, callback) {
      this.listeners.splice(this.listeners.indexOf(callback), 1);
    },
  };
  const documentRef = {
    hidden: false,
    listeners: [],
    addEventListener(_, callback) {
      this.listeners.push(callback);
    },
    removeEventListener(_, callback) {
      this.listeners.splice(this.listeners.indexOf(callback), 1);
    },
  };
  let statusChanges = 0;
  const rendering = createOceanCurrentRendering({
    cesium: { Cartesian3: { fromDegrees: (x, y, z) => ({ x, y, z }) } },
    getViewer: () => viewer,
    overlayHost,
    onStatusChange: () => statusChanges++,
    createGpuRendering: () => gpu,
    createClock(options) {
      clock.canRun = options.canRun;
      clock.onFrame = options.onFrame;
      return fakeClock;
    },
    matchMedia: () => media,
    documentRef,
  });
  return {
    rendering,
    gpuCalls,
    gpuState,
    hostCalls,
    published,
    flights,
    clock,
    sceneListeners,
    renders,
    media,
    documentRef,
    statusChanges: () => statusChanges,
    preRender: () => sceneListeners.preRender.forEach((callback) => callback()),
    named: (name) => gpuCalls.filter(([call]) => call === name),
  };
}

test('start then setCurrents publishes labels, shows the drawing and arms the clock', () => {
  const h = harness();
  h.rendering.start();
  assert.equal(h.clock.running, true);
  assert.equal(h.clock.pending, false, 'nothing to animate before data');
  assert.equal(h.sceneListeners.preRender.length, 1);
  assert.equal(h.sceneListeners.moveEnd.length, 1);
  assert.equal(h.media.listeners.length, 1);
  assert.equal(h.documentRef.listeners.length, 1);
  assert.equal(h.rendering.setCurrents(records()), true);
  assert.deepEqual(h.named('setCurrents'), [['setCurrents', 2]]);
  assert.deepEqual(h.hostCalls, [
    ['setVisible', OVERLAY_SOURCE_ID, true],
    ['setEntries', OVERLAY_SOURCE_ID, 2],
  ]);
  assert.equal(h.clock.pending, true);
  assert.ok(h.renders.length > 0, 'a static frame is requested');
  const diagnostics = h.rendering.getDiagnostics();
  assert.equal(diagnostics.gpuActive, true);
  assert.equal(diagnostics.gpuVisible, true);
  assert.equal(diagnostics.labelsShown, true);
  assert.equal(diagnostics.primitiveCount, 2);
  assert.equal(diagnostics.framePending, true);
  const renders = h.renders.length;
  h.clock.onFrame(1.5);
  assert.deepEqual(h.named('tick'), [['tick', 1.5]]);
  assert.equal(h.renders.length, renders + 1, 'each frame requests one render');
  h.rendering.destroy();
});

test('activating a published label flies the camera over the current at globe scale', () => {
  const h = harness();
  h.rendering.start();
  h.rendering.setCurrents(records());
  const [first, second] = h.published.entries;
  assert.equal(first.accessibilityLabel, 'A, warm current');
  assert.equal(second.accessibilityLabel, 'B, cold current');
  assert.equal(typeof second.activate, 'function');
  assert.equal(second.activate(), true);
  assert.deepEqual(h.flights, [
    {
      destination: { x: 10, y: 10, z: ACTIVATE_HEIGHT_METERS },
      duration: ACTIVATE_FLIGHT_SECONDS,
    },
  ]);
  h.media.matches = true;
  h.media.listeners[0]();
  assert.equal(first.activate(), true);
  assert.deepEqual(h.flights[1], {
    destination: { x: 0, y: 0, z: ACTIVATE_HEIGHT_METERS },
    duration: 0,
  });
  h.rendering.destroy();
  const noCamera = harness({ flyTo: false });
  noCamera.rendering.start();
  noCamera.rendering.setCurrents(records());
  assert.equal(
    noCamera.published.entries[0].activate(),
    false,
    'without a camera the activation reports that it did nothing',
  );
  noCamera.rendering.destroy();
});

test('labels follow the height fade and the clock stops when nothing is visible', () => {
  const h = harness();
  h.rendering.start();
  h.rendering.setCurrents(records());
  h.hostCalls.length = 0;
  h.gpuState.heightFade = 0;
  h.gpuState.visible = false;
  h.preRender();
  assert.deepEqual(h.hostCalls, [
    ['clearSource', OVERLAY_SOURCE_ID],
    ['setVisible', OVERLAY_SOURCE_ID, false],
  ]);
  assert.equal(h.clock.pending, false);
  assert.equal(h.rendering.getDiagnostics().labelsShown, false);
  h.preRender();
  assert.equal(h.hostCalls.length, 2, 'staying faded republishes nothing');
  h.gpuState.heightFade = 0.4;
  h.gpuState.visible = true;
  h.preRender();
  assert.deepEqual(h.hostCalls.slice(2), [
    ['setVisible', OVERLAY_SOURCE_ID, true],
    ['setEntries', OVERLAY_SOURCE_ID, 2],
  ]);
  assert.equal(h.clock.pending, true);
  h.preRender();
  assert.equal(h.hostCalls.length, 4, 'a steady view republishes nothing');
  h.rendering.destroy();
});

test('pause, reduced motion and a hidden tab each stop the animation without hiding the drawing', () => {
  const h = harness();
  h.rendering.start();
  h.rendering.setCurrents(records());
  assert.equal(h.clock.canRun(), true);
  h.rendering.setOptions({ paused: true });
  assert.deepEqual(h.named('setOptions').at(-1), ['setOptions', true]);
  assert.equal(h.clock.canRun(), false);
  assert.equal(h.clock.pending, false);
  assert.equal(h.rendering.getDiagnostics().labelsShown, true);
  h.rendering.setOptions({ paused: true });
  const options = h.named('setOptions').length;
  h.rendering.setOptions({ paused: 'no' });
  assert.equal(
    h.named('setOptions').length,
    options,
    'unchanged or invalid pause is ignored',
  );
  h.rendering.setOptions({ paused: false });
  assert.equal(h.clock.canRun(), true);
  h.media.matches = true;
  h.media.listeners[0]();
  assert.deepEqual(h.named('setOptions').at(-1), ['setOptions', true]);
  assert.equal(h.rendering.getDiagnostics().reducedMotion, true);
  assert.equal(h.rendering.getDiagnostics().paused, false);
  assert.equal(h.clock.canRun(), false);
  h.media.matches = false;
  h.media.listeners[0]();
  assert.equal(h.clock.canRun(), true);
  h.documentRef.hidden = true;
  h.documentRef.listeners[0]();
  assert.equal(h.clock.canRun(), false);
  assert.equal(h.rendering.getDiagnostics().hidden, true);
  h.documentRef.hidden = false;
  h.documentRef.listeners[0]();
  assert.equal(h.clock.canRun(), true);
  h.rendering.destroy();
});

test('readiness changes notify the row once per flip; moveEnd wakes a parked scene', () => {
  const h = harness();
  h.rendering.start();
  h.gpuState.ready = false;
  h.rendering.setCurrents(records());
  const before = h.statusChanges();
  h.preRender();
  assert.equal(h.statusChanges(), before, 'unchanged readiness stays quiet');
  h.gpuState.ready = true;
  h.preRender();
  assert.equal(h.statusChanges(), before + 1);
  h.preRender();
  assert.equal(h.statusChanges(), before + 1);
  const renders = h.renders.length;
  h.sceneListeners.moveEnd[0]();
  assert.ok(h.renders.length > renders);
  h.rendering.destroy();
});

test('stop detaches listeners and hides labels; clear releases geometry; destroy releases the GPU', () => {
  const h = harness();
  h.rendering.start();
  h.rendering.setCurrents(records());
  h.hostCalls.length = 0;
  h.rendering.stop();
  assert.equal(h.sceneListeners.preRender.length, 0);
  assert.equal(h.sceneListeners.moveEnd.length, 0);
  assert.equal(h.media.listeners.length, 0);
  assert.equal(h.documentRef.listeners.length, 0);
  assert.equal(h.clock.running, false);
  assert.deepEqual(h.hostCalls, [
    ['clearSource', OVERLAY_SOURCE_ID],
    ['setVisible', OVERLAY_SOURCE_ID, false],
  ]);
  h.rendering.stop();
  assert.equal(h.hostCalls.length, 2);
  h.rendering.clear();
  assert.ok(h.named('clear').length >= 1);
  const diagnostics = h.rendering.getDiagnostics();
  assert.equal(diagnostics.gpuActive, false);
  assert.equal(diagnostics.gpuVisible, false);
  assert.equal(diagnostics.labelsShown, false);
  h.rendering.start();
  assert.equal(
    h.clock.pending,
    false,
    'no data after clear, nothing to animate',
  );
  h.rendering.destroy();
  assert.equal(h.named('destroy').length, 1);
  assert.equal(h.clock.running, false);
});

test('an unsupported GPU path draws nothing and publishes no labels', () => {
  const h = harness({ supported: false });
  h.rendering.start();
  assert.equal(h.rendering.setCurrents(records()), false);
  assert.deepEqual(h.hostCalls, []);
  assert.equal(h.clock.pending, false);
  assert.equal(h.rendering.getDiagnostics().gpuActive, false);
  h.rendering.destroy();
});

test('setCurrents before start stays dormant until start', () => {
  const h = harness();
  assert.equal(h.rendering.setCurrents(records()), true);
  assert.deepEqual(h.hostCalls, [], 'no labels while stopped');
  assert.equal(h.clock.pending, false);
  h.rendering.start();
  assert.deepEqual(h.hostCalls, [
    ['setVisible', OVERLAY_SOURCE_ID, true],
    ['setEntries', OVERLAY_SOURCE_ID, 2],
  ]);
  assert.equal(h.clock.pending, true);
  h.rendering.destroy();
});
