import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBundledJson } from '../../data/bundledJson.js';
import {
  currentColor,
  currentDashCount,
  currentFlowRate,
  currentLabelPriority,
  currentPathLengthKm,
  currentReferencePoint,
  normalizeCurrentFeatures,
  summarizeCurrents,
  validateCurrentFeature,
} from './model.js';
import {
  COLD_COLOR,
  FLOW_RATE_PER_SECOND,
  VALID_BASINS,
  VALID_TEMPS,
  WARM_COLOR,
} from './policy.js';

const bundle = () =>
  loadBundledJson(
    new URL(
      '../../data/local_data/ocean_currents/currents.json',
      import.meta.url,
    ),
  );

const feature = (overrides = {}, coordinates) => ({
  type: 'Feature',
  id: 'test-current',
  properties: { name: 'Test Current', temp: 'warm', basin: 'atlantic' },
  geometry: {
    type: 'LineString',
    coordinates: coordinates ?? [
      [0, 0],
      [5, 1],
      [10, 2],
      [15, 3],
    ],
  },
  ...overrides,
});

test('the bundled schematic validates and pins the README totals', async () => {
  const json = await bundle();
  assert.equal(json.type, 'FeatureCollection');
  assert.equal(json.meta.license, 'CC0-1.0');
  assert.equal(json.meta.schematic, true);
  assert.equal(json.meta.authored, '2026-11-08');
  assert.equal(json.features.length, 32);
  const ids = new Set();
  for (const current of json.features) {
    assert.deepEqual(validateCurrentFeature(current), [], current.id);
    assert.match(current.id, /^[a-z0-9-]+$/);
    assert.equal(current.properties.id, current.id);
    assert.ok(!ids.has(current.id), `duplicate id ${current.id}`);
    ids.add(current.id);
    assert.ok(current.properties.name.trim().length > 0);
    assert.ok(VALID_TEMPS.has(current.properties.temp));
    assert.ok(VALID_BASINS.has(current.properties.basin));
    const coordinates = current.geometry.coordinates;
    assert.ok(coordinates.length >= 4, `${current.id} needs 4 vertices`);
    assert.ok(coordinates.length <= 12, `${current.id} has too many vertices`);
    for (let i = 0; i < coordinates.length; i++) {
      const [lon, lat] = coordinates[i];
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
      assert.ok(lon >= -180 && lon < 360, `${current.id} lon ${lon}`);
      assert.ok(lat >= -90 && lat <= 90, `${current.id} lat ${lat}`);
      if (i > 0)
        assert.ok(
          Math.abs(lon - coordinates[i - 1][0]) < 180,
          `${current.id} jumps the antimeridian at vertex ${i}`,
        );
    }
  }
  const names = new Set(json.features.map((f) => f.properties.name));
  assert.equal(names.size, 30);
  const warm = json.features.filter((f) => f.properties.temp === 'warm');
  assert.equal(warm.length, 20);
  assert.equal(json.features.length - warm.length, 12);
  const acc = json.features.filter(
    (f) => f.properties.name === 'Antarctic Circumpolar Current',
  );
  assert.equal(acc.length, 3);
  assert.ok(acc.every((f) => f.properties.basin === 'southern'));
});

test('records derive length, dash count, rate and the label reference', async () => {
  const records = normalizeCurrentFeatures(await bundle());
  assert.equal(records.length, 32);
  const gulf = records.find((record) => record.id === 'gulf-stream');
  assert.equal(gulf.temp, 'warm');
  assert.equal(gulf.speedClass, 'fast');
  assert.equal(gulf.rank, 1);
  assert.equal(gulf.rate, FLOW_RATE_PER_SECOND * 1.5);
  assert.ok(gulf.lengthKm > 3000 && gulf.lengthKm < 5000, gulf.lengthKm);
  assert.equal(gulf.dashCount, currentDashCount(gulf.lengthKm));
  assert.deepEqual(
    gulf.reference,
    gulf.coordinates[Math.floor(gulf.coordinates.length / 2)],
  );
  const pacific = records.find(
    (record) => record.id === 'north-pacific-current',
  );
  assert.ok(pacific.coordinates.some(([lon]) => lon > 180));
  assert.ok(
    pacific.lengthKm > 5000,
    'continuous longitudes measure the real path',
  );
  for (const record of records) assert.ok(record.dashCount >= 2);
  assert.deepEqual(summarizeCurrents(records), {
    total: 30,
    warm: 20,
    cold: 10,
    features: 32,
  });
});

test('pure helpers: colour, rate, dash count, reference, priority, length', () => {
  assert.equal(currentColor('warm'), WARM_COLOR);
  assert.equal(currentColor('cold'), COLD_COLOR);
  assert.equal(currentFlowRate('fast'), FLOW_RATE_PER_SECOND * 1.5);
  assert.equal(currentFlowRate('slow'), FLOW_RATE_PER_SECOND * 0.65);
  assert.equal(currentFlowRate('moderate'), FLOW_RATE_PER_SECOND);
  assert.equal(currentFlowRate('torrential'), FLOW_RATE_PER_SECOND);
  assert.equal(currentDashCount(100), 2, 'a short line still shows two dashes');
  assert.equal(currentDashCount(6000), 5);
  assert.deepEqual(
    currentReferencePoint([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]),
    [2, 2],
  );
  assert.deepEqual(
    currentReferencePoint([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]),
    [2, 2],
  );
  assert.equal(currentLabelPriority(1), 900);
  assert.equal(currentLabelPriority(2), 800);
  assert.equal(currentLabelPriority(undefined), 800);
  const quarter = currentPathLengthKm([
    [0, 0],
    [90, 0],
  ]);
  assert.ok(Math.abs(quarter - 10007.5) < 2, quarter);
  assert.equal(currentPathLengthKm([[0, 0]]), 0);
  assert.deepEqual(summarizeCurrents(null), {
    total: 0,
    warm: 0,
    cold: 0,
    features: 0,
  });
});

test('validateCurrentFeature names every authoring mistake', () => {
  assert.deepEqual(validateCurrentFeature(feature()), []);
  assert.match(
    validateCurrentFeature(
      feature({}, [
        [0, 0],
        [5, 1],
        [10, 2],
      ]),
    ).join(' '),
    /vertices/,
  );
  assert.match(
    validateCurrentFeature(
      feature({ properties: { name: 'X', temp: 'tepid', basin: 'atlantic' } }),
    ).join(' '),
    /temp/,
  );
  assert.match(
    validateCurrentFeature(
      feature({}, [
        [0, 0],
        [NaN, 1],
        [10, 2],
        [15, 3],
      ]),
    ).join(' '),
    /finite/,
  );
  assert.match(
    validateCurrentFeature(
      feature({}, [
        [-170, 0],
        [30, 0],
        [40, 0],
        [50, 0],
      ]),
    ).join(' '),
    /jumps 200 degrees at vertex 1/,
  );
  assert.match(
    validateCurrentFeature(feature({ id: 'Gulf Stream' })).join(' '),
    /id/,
  );
  assert.match(
    validateCurrentFeature(
      feature({}, [
        [350, 0],
        [355, 0],
        [360, 0],
        [365, 0],
      ]),
    ).join(' '),
    /longitude 360/,
  );
  assert.match(
    validateCurrentFeature(
      feature({ properties: { name: 'X', temp: 'warm', basin: 'arctic' } }),
    ).join(' '),
    /basin/,
  );
  assert.match(
    validateCurrentFeature(
      feature({
        properties: { name: 'X', temp: 'warm', basin: 'indian', rank: 3 },
      }),
    ).join(' '),
    /rank/,
  );
  assert.match(
    validateCurrentFeature(
      feature({ properties: { name: '', temp: 'warm', basin: 'indian' } }),
    ).join(' '),
    /name/,
  );
});

test('normalizeCurrentFeatures throws naming the first bad feature', () => {
  assert.throws(
    () =>
      normalizeCurrentFeatures({
        features: [
          feature({ id: 'fine-one' }),
          feature({ id: 'bad-one' }, [
            [0, 0],
            [1, 1],
            [2, 2],
          ]),
        ],
      }),
    (error) =>
      error instanceof TypeError &&
      /Ocean current bad-one: .*vertices/.test(error.message),
  );
  assert.throws(
    () =>
      normalizeCurrentFeatures({
        features: [feature({ id: 'twice' }), feature({ id: 'twice' })],
      }),
    /Ocean current twice: duplicate id/,
  );
  assert.throws(() => normalizeCurrentFeatures({ type: 'Feature' }), TypeError);
  const [record] = normalizeCurrentFeatures({
    features: [
      feature({
        properties: {
          name: '  Padded  ',
          temp: 'cold',
          basin: 'pacific',
          speedClass: 'slow',
          rank: 1,
        },
      }),
    ],
  });
  assert.equal(record.name, 'Padded');
  assert.equal(record.speedClass, 'slow');
  assert.equal(record.rank, 1);
  assert.equal(record.rate, FLOW_RATE_PER_SECOND * 0.65);
});
