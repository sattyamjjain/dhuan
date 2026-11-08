import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createSeafloorOverlayEntry,
  createSeafloorOverlayPublisher,
  createSeafloorSweepGate,
  minorFeaturesEligible,
  seafloorImportance,
  seafloorLabel,
  seafloorLabelCap,
  seafloorLabelPriority,
  seafloorTypeWord,
  selectSeafloorLabelWinners,
} from './overlay.js';
import {
  SEAFLOOR_FAMILY_COLORS,
  SEAFLOOR_LABEL_MAX_DISTANCE_M,
  SEAFLOOR_LABEL_WINNER_CAP,
  SEAFLOOR_MINOR_CAMERA_HEIGHT_M,
  SEAFLOOR_OVERLAY_COLLISION_CAPACITY,
  SEAFLOOR_OVERLAY_SOURCE_ID,
} from './policy.js';

function record(index, overrides = {}) {
  return {
    id: `seafloor-${index}`,
    label: `Feature ${index}`,
    kind: 'major',
    rank: 1,
    visible: true,
    distanceM: 1_000_000 + index,
    ...overrides,
  };
}

test('major features always qualify; minor ones only up close or with every name', () => {
  const records = [
    record(0, { kind: 'major', rank: 1 }),
    record(1, { kind: 'minor', rank: 10 }),
  ];
  const far = { cameraHeightM: 4_000_000, names: 'major' };
  assert.deepEqual(
    selectSeafloorLabelWinners(records, far).map((r) => r.id),
    ['seafloor-0'],
  );
  assert.deepEqual(
    selectSeafloorLabelWinners(records, { ...far, names: 'all' }).map(
      (r) => r.id,
    ),
    ['seafloor-0', 'seafloor-1'],
  );
  assert.deepEqual(
    selectSeafloorLabelWinners(records, {
      cameraHeightM: SEAFLOOR_MINOR_CAMERA_HEIGHT_M - 1,
      names: 'major',
    }).map((r) => r.id),
    ['seafloor-0', 'seafloor-1'],
  );
  assert.equal(minorFeaturesEligible({ cameraHeightM: NaN }), false);
  assert.equal(minorFeaturesEligible({ names: 'all' }), true);
});

test('winners are hard-capped at 80 from global framing and 160 below it', () => {
  const records = Array.from({ length: 300 }, (_, i) => record(i));
  assert.equal(seafloorLabelCap(3_000_000), 80);
  assert.equal(seafloorLabelCap(2_999_999), SEAFLOOR_LABEL_WINNER_CAP);
  assert.equal(seafloorLabelCap(50_000), SEAFLOOR_LABEL_WINNER_CAP);
  assert.equal(seafloorLabelCap(50_000, 40), 40);
  assert.equal(
    selectSeafloorLabelWinners(records, { cameraHeightM: 5_000_000 }).length,
    80,
  );
  assert.equal(
    selectSeafloorLabelWinners(records, { cameraHeightM: 500_000 }).length,
    SEAFLOOR_LABEL_WINNER_CAP,
  );
  assert.deepEqual(selectSeafloorLabelWinners(records, { limit: 0 }), []);
});

test('ranking is importance, then distance, then id; hidden and far records drop out', () => {
  const records = [
    record(0, { rank: 10, distanceM: 10 }),
    record(1, { rank: 1, distanceM: 5_000_000 }),
    record(2, { rank: 1, distanceM: 2_000_000 }),
    record(3, { rank: 1, distanceM: 2_000_000 }),
    record(4, { visible: false }),
    record(5, { distanceM: SEAFLOOR_LABEL_MAX_DISTANCE_M + 1 }),
    record(6, { label: '' }),
  ];
  assert.deepEqual(
    selectSeafloorLabelWinners(records, { cameraHeightM: 1_000_000 }).map(
      (r) => r.id,
    ),
    ['seafloor-2', 'seafloor-3', 'seafloor-1', 'seafloor-0'],
  );
});

test('a size-adjusted prominence outranks the bare type rank when a record carries one', () => {
  const records = [
    record(0, { rank: 2, prominence: 2, distanceM: 10 }), // small ridge, nearest
    record(1, { rank: 7, prominence: -3, distanceM: 3_000_000 }), // 20-degree basin
    record(2, { rank: 1, distanceM: 2_000_000 }), // trench without a prominence
  ];
  assert.deepEqual(
    selectSeafloorLabelWinners(records, { cameraHeightM: 5_000_000 }).map(
      (r) => r.id,
    ),
    ['seafloor-1', 'seafloor-2', 'seafloor-0'],
  );
  assert.equal(seafloorImportance({ rank: 4 }), 4);
  assert.equal(seafloorImportance({ rank: 4, prominence: -1 }), -1);
  assert.equal(seafloorImportance({}), 30);
  assert.ok(seafloorLabelPriority(-9, 0) > seafloorLabelPriority(1, 0));
});

test('label priority falls with rank and with distance', () => {
  assert.ok(seafloorLabelPriority(1, 0) > seafloorLabelPriority(2, 0));
  assert.ok(seafloorLabelPriority(1, 0) > seafloorLabelPriority(1, 1_000_000));
  assert.equal(
    seafloorLabelPriority(1, 10_000),
    seafloorLabelPriority(1, 20_000),
    'quantised to 50 km buckets',
  );
  assert.equal(
    seafloorLabelPriority(NaN, NaN),
    seafloorLabelPriority(30, SEAFLOOR_LABEL_MAX_DISTANCE_M),
  );
});

test('labels read name then type, clamped', () => {
  assert.equal(
    seafloorLabel({ name: 'Mariana', type: 'Trench' }),
    'Mariana Trench',
  );
  assert.equal(
    seafloorLabel({ name: 'Acapulco', type: 'Seamounts' }),
    'Acapulco Seamounts',
  );
  assert.equal(
    seafloorLabel({ name: ' Odd  spacing ', type: '' }),
    'Odd spacing',
  );
  assert.equal(
    seafloorLabel({ name: 'x'.repeat(50), type: 'Bank' }, 20).length,
    20,
  );
});

test('overlay entries satisfy the shared label contract and reach the screen-reader mirror', () => {
  const anchor = Cesium.Cartesian3.fromDegrees(-30, 30, 0);
  let activated = 0;
  const entry = createSeafloorOverlayEntry(
    {
      id: 'seafloor-7',
      label: 'Mariana Trench',
      type: 'Trench',
      family: 'trench',
      rank: 1,
      anchor,
      distanceM: 100_000,
    },
    { activate: () => ++activated },
  );
  assert.equal(entry.id, 'seafloor-7');
  assert.equal(entry.position, anchor);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'Mariana Trench');
  assert.equal(entry.accessibilityLabel, 'Mariana Trench, trench');
  assert.equal(entry.accent, SEAFLOOR_FAMILY_COLORS.trench);
  assert.equal(entry.collisionGroup, 'ambient-label');
  // The host lists only interactive entries with a label AND an activator.
  assert.equal(entry.interactive, true);
  assert.equal(entry.activate(), 1);
  assert.equal(entry.placement, 'above');
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.maxDistance, SEAFLOOR_LABEL_MAX_DISTANCE_M);
  const bare = createSeafloorOverlayEntry({ family: 'nope' });
  assert.equal(bare.accent, SEAFLOOR_FAMILY_COLORS.other);
  assert.equal(bare.activate, undefined, 'no activator unless one is given');
});

test('the spoken type word is singular, lower case and falls back for rare types', () => {
  assert.equal(seafloorTypeWord('Seamounts'), 'seamount');
  assert.equal(seafloorTypeWord('Fracture Zone'), 'fracture zone');
  assert.equal(seafloorTypeWord('Tablemount'), 'guyot');
  assert.equal(seafloorTypeWord('Salt Dome Province'), 'sea floor feature');
  assert.equal(
    createSeafloorOverlayEntry({
      label: 'Acapulco Seamounts',
      type: 'Seamounts',
    }).accessibilityLabel,
    'Acapulco Seamounts, seamount',
  );
});

test('the publisher shows, publishes with the shared budget and clears on hide', () => {
  const calls = [];
  const publisher = createSeafloorOverlayPublisher({
    host: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clear', ...args]),
    },
  });
  publisher.publish([{ id: 'early' }]);
  assert.deepEqual(calls, [], 'publishing while hidden is dropped');
  publisher.show();
  publisher.show();
  publisher.publish([{ id: 'a' }]);
  publisher.hide();
  publisher.hide();
  assert.deepEqual(calls, [
    ['visible', SEAFLOOR_OVERLAY_SOURCE_ID, true],
    [
      'entries',
      SEAFLOOR_OVERLAY_SOURCE_ID,
      [{ id: 'a' }],
      {
        cohortLimit: SEAFLOOR_LABEL_WINNER_CAP,
        collisionCapacity: SEAFLOOR_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    ],
    ['clear', SEAFLOOR_OVERLAY_SOURCE_ID],
    ['visible', SEAFLOOR_OVERLAY_SOURCE_ID, false],
  ]);
});

test('the sweep gate runs once when dirty, stays idle while parked and re-arms on travel', () => {
  let now = 0;
  const gate = createSeafloorSweepGate({ now: () => now });
  const camera = { positionWC: Cesium.Cartesian3.fromDegrees(0, 0, 4_000_000) };
  assert.equal(gate.shouldRun(camera, 4_000_000), true, 'initially dirty');
  for (let i = 0; i < 10; i++) {
    now += 1_500;
    assert.equal(gate.shouldRun(camera, 4_000_000), false, 'parked');
  }
  camera.positionWC = Cesium.Cartesian3.fromDegrees(5, 0, 4_000_000);
  assert.equal(
    gate.shouldRun(camera, 4_000_000),
    false,
    'inside the probe window',
  );
  now += 1_500;
  assert.equal(
    gate.shouldRun(camera, 4_000_000),
    true,
    'travelled past epsilon',
  );
  gate.markDirty();
  assert.equal(gate.shouldRun(camera, 4_000_000), true);
  assert.equal(gate.shouldRun(undefined), false, 'no camera, no fallback');
  gate.reset();
  assert.equal(gate.shouldRun(camera, 4_000_000), true);
});
