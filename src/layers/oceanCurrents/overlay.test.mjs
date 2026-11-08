import test from 'node:test';
import assert from 'node:assert/strict';
import { Cartesian3 } from 'cesium';
import {
  createCurrentOverlayEntry,
  createCurrentOverlayPublisher,
  currentOverlayEntries,
} from './overlay.js';
import {
  COLD_COLOR,
  DISPLAY_HEIGHT_METERS,
  LABEL_MAX_DISTANCE_M,
  OVERLAY_COHORT_LIMIT,
  OVERLAY_COLLISION_CAPACITY,
  OVERLAY_SOURCE_ID,
  WARM_COLOR,
} from './policy.js';

const record = (overrides = {}) => ({
  id: 'gulf-stream',
  name: 'Gulf Stream',
  temp: 'warm',
  basin: 'atlantic',
  rank: 1,
  reference: [-75, 35],
  ...overrides,
});

test('an entry is an ambient label that names its temperature in words and colour', () => {
  const position = new Cartesian3(1, 2, 3);
  const entry = createCurrentOverlayEntry(record(), position);
  assert.equal(entry.id, 'ocean-current-gulf-stream');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'Gulf Stream · warm current');
  assert.equal(entry.accessibilityLabel, 'Gulf Stream, warm current');
  assert.equal(entry.accent, WARM_COLOR);
  assert.equal(entry.priority, 900);
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(
    entry.interactive,
    true,
    'the host lists only interactive entries for assistive technology',
  );
  assert.equal(
    Object.hasOwn(entry, 'activate'),
    false,
    'no activation unless the renderer supplies one',
  );
  assert.equal(entry.minDistance, 0);
  assert.equal(entry.maxDistance, LABEL_MAX_DISTANCE_M);
  assert.equal(entry.distanceFadeStartRatio, 0.85);
  assert.deepEqual(entry.distanceScale, {
    near: 2_000_000,
    nearValue: 1,
    far: 25_000_000,
    farValue: 0.72,
  });
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.terrainOcclusion, false);
  assert.equal(entry.gapPx, 6);
  assert.equal(entry.placement, 'above');
  const cold = createCurrentOverlayEntry(
    record({
      id: 'canary-current',
      name: 'Canary Current',
      temp: 'cold',
      rank: 2,
    }),
    position,
  );
  assert.equal(cold.id, 'ocean-current-canary-current');
  assert.equal(cold.title, 'Canary Current · cold current');
  assert.equal(cold.accessibilityLabel, 'Canary Current, cold current');
  assert.equal(cold.accent, COLD_COLOR);
  assert.equal(cold.priority, 800);
});

test('an activate callback is attached only when it is a function', () => {
  const activate = () => 'flown';
  const entry = createCurrentOverlayEntry(record(), new Cartesian3(), {
    activate,
  });
  assert.equal(entry.activate, activate);
  assert.equal(entry.activate(), 'flown');
  const ignored = createCurrentOverlayEntry(record(), new Cartesian3(), {
    activate: 'nope',
  });
  assert.equal(Object.hasOwn(ignored, 'activate'), false);
});

test('entries hang from the middle vertex lifted to the display height and bind activation to their record', () => {
  const flown = [];
  const records = [
    record(),
    record({ id: 'kuroshio', name: 'Kuroshio', reference: [190, 43] }),
  ];
  const entries = currentOverlayEntries(
    records,
    { Cartesian3 },
    { activate: (current) => flown.push(current.id) && 'ok' },
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries[0].position,
    Cartesian3.fromDegrees(-75, 35, DISPLAY_HEIGHT_METERS),
  );
  assert.deepEqual(
    entries[1].position,
    Cartesian3.fromDegrees(190, 43, DISPLAY_HEIGHT_METERS),
  );
  assert.ok(
    Cartesian3.distance(
      entries[1].position,
      Cartesian3.fromDegrees(-170, 43, DISPLAY_HEIGHT_METERS),
    ) < 1e-6,
    'longitudes past 180 resolve like their wrapped twin',
  );
  assert.equal(entries[1].activate(), 'ok');
  assert.deepEqual(flown, ['kuroshio']);
  assert.deepEqual(currentOverlayEntries(null, { Cartesian3 }), []);
  const plain = currentOverlayEntries(records, { Cartesian3 });
  assert.equal(Object.hasOwn(plain[0], 'activate'), false);
});

function fakeHost() {
  const calls = [];
  return {
    calls,
    host: {
      setVisible: (...args) => calls.push(['setVisible', ...args]),
      setEntries: (...args) => calls.push(['setEntries', ...args]),
      clearSource: (...args) => calls.push(['clearSource', ...args]),
    },
  };
}

test('the publisher shows once, drops publishes while hidden, and hides idempotently', () => {
  const { host, calls } = fakeHost();
  const publisher = createCurrentOverlayPublisher({ host });
  const entries = [
    createCurrentOverlayEntry(record(), new Cartesian3(1, 2, 3)),
  ];
  assert.equal(publisher.isVisible(), false);
  publisher.publish(entries);
  assert.deepEqual(calls, [], 'a publish while hidden reaches nothing');
  publisher.hide();
  assert.deepEqual(calls, [], 'hiding a hidden publisher is a no-op');
  publisher.show();
  publisher.show();
  assert.deepEqual(calls, [['setVisible', OVERLAY_SOURCE_ID, true]]);
  assert.equal(publisher.isVisible(), true);
  publisher.publish(entries);
  assert.deepEqual(calls[1], [
    'setEntries',
    OVERLAY_SOURCE_ID,
    entries,
    {
      cohortLimit: OVERLAY_COHORT_LIMIT,
      collisionCapacity: OVERLAY_COLLISION_CAPACITY,
      moving: false,
    },
  ]);
  publisher.hide();
  assert.deepEqual(calls.slice(2), [
    ['clearSource', OVERLAY_SOURCE_ID],
    ['setVisible', OVERLAY_SOURCE_ID, false],
  ]);
  publisher.hide();
  assert.equal(calls.length, 4);
  assert.equal(publisher.isVisible(), false);
  publisher.show();
  publisher.publish([]);
  publisher.hide();
  assert.deepEqual(
    calls.slice(4),
    [
      ['setVisible', OVERLAY_SOURCE_ID, true],
      ['setEntries', OVERLAY_SOURCE_ID, [], calls[1][3]],
      ['setVisible', OVERLAY_SOURCE_ID, false],
    ],
    'an empty publish leaves nothing to clear',
  );
});

test('a custom source id reaches every host call', () => {
  const { host, calls } = fakeHost();
  const publisher = createCurrentOverlayPublisher({
    host,
    sourceId: 'test-currents',
  });
  publisher.show();
  publisher.publish([createCurrentOverlayEntry(record(), new Cartesian3())]);
  publisher.hide();
  assert.deepEqual(
    calls.map(([name, sourceId]) => [name, sourceId]),
    [
      ['setVisible', 'test-currents'],
      ['setEntries', 'test-currents'],
      ['clearSource', 'test-currents'],
      ['setVisible', 'test-currents'],
    ],
  );
});
