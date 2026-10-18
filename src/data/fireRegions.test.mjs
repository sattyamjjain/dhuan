import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countFiresInRegions,
  normalizeFireRegions,
  pointInBbox,
} from './fireRegions.js';

const PUNJAB_HARYANA = {
  id: 'punjab-haryana',
  label: 'Punjab + Haryana (bounding box)',
  shortLabel: 'PUNJAB+HARYANA',
  bbox: { west: 73.8, south: 27.6, east: 77.6, north: 32.6 },
};

test('regions normalise and drop malformed boxes without counting the world', () => {
  const rows = normalizeFireRegions([
    PUNJAB_HARYANA,
    { id: 'broken', bbox: { west: 'x', south: 1, east: 2, north: 3 } },
    { id: 'inverted', bbox: { west: 0, south: 10, east: 1, north: 5 } },
    { id: 'punjab-haryana', bbox: PUNJAB_HARYANA.bbox }, // duplicate id
    null,
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['punjab-haryana'],
  );
  assert.equal(rows[0].shortLabel, 'PUNJAB+HARYANA');
  assert.deepEqual(normalizeFireRegions(undefined), []);
});

test('a point is inside a box, including one crossing the antimeridian', () => {
  assert.equal(pointInBbox({ lat: 30.3, lon: 75.6 }, PUNJAB_HARYANA.bbox), true);
  assert.equal(pointInBbox({ lat: 26.9, lon: 75.6 }, PUNJAB_HARYANA.bbox), false);
  assert.equal(pointInBbox({ lat: 30.3, lon: 78.0 }, PUNJAB_HARYANA.bbox), false);
  const dateline = { west: 170, south: -10, east: -170, north: 10 };
  assert.equal(pointInBbox({ lat: 0, lon: 175 }, dateline), true);
  assert.equal(pointInBbox({ lat: 0, lon: -175 }, dateline), true);
  assert.equal(pointInBbox({ lat: 0, lon: 0 }, dateline), false);
  assert.equal(pointInBbox({ lat: NaN, lon: 0 }, dateline), false);
});

test('counts fall per region in the regions order and never carry the box', () => {
  const fires = [
    { lat: 30.9, lon: 75.8 }, // Ludhiana
    { lat: 29.4, lon: 76.0 }, // Haryana
    { lat: 28.6, lon: 77.2 }, // Delhi (inside the box, by design)
    { lat: 26.9, lon: 80.9 }, // Lucknow, outside
    { lat: 'bad', lon: 75 },
  ];
  const rows = countFiresInRegions(fires, [
    PUNJAB_HARYANA,
    { id: 'delhi', label: 'Delhi', bbox: { west: 76.8, south: 28.4, east: 77.4, north: 28.9 } },
  ]);
  assert.deepEqual(rows, [
    {
      id: 'punjab-haryana',
      label: 'Punjab + Haryana (bounding box)',
      shortLabel: 'PUNJAB+HARYANA',
      count: 3,
    },
    { id: 'delhi', label: 'Delhi', shortLabel: 'Delhi', count: 1 },
  ]);
  assert.deepEqual(countFiresInRegions([], [PUNJAB_HARYANA])[0].count, 0);
  assert.deepEqual(countFiresInRegions(fires, []), []);
});
