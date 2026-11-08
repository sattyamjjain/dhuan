import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXTENT_TIER_BONUS,
  EXTENT_TIER_DEGREES,
  SEAFLOOR_FAMILIES,
  TYPE_TABLE,
  UNKNOWN_TYPE_RANK,
  classifyFeatureType,
  familyForType,
  featureExtentDegrees,
  normalizeFeatureType,
  seafloorProminence,
} from './classification.js';

test('plural and variant spellings normalise to the canonical type', () => {
  const cases = [
    ['Seamounts', 'Seamount'],
    ['Seamount Chain', 'Seamount'],
    ['Seamount Province', 'Seamount'],
    ['Abyssal Hills', 'Hill'],
    ['Abyssal Hill', 'Hill'],
    ['Mid-Ocean Ridge', 'Ridge'],
    ['Ridges', 'Ridge'],
    ['Fracture Zones', 'Fracture Zone'],
    ['Fracture Zone System', 'Fracture Zone'],
    ['Tablemount', 'Guyot'],
    ['Guyots', 'Guyot'],
    ['Sea Channel', 'Channel'],
    ['Seachannel', 'Channel'],
    ['Sea Valleys', 'Valley'],
    ['Canyons', 'Canyon'],
    ['Continental Slope', 'Slope'],
    ['Plain', 'Abyssal Plain'],
    ['  trench  ', 'Trench'],
  ];
  for (const [raw, type] of cases)
    assert.equal(classifyFeatureType(raw).type, type, raw);
  assert.equal(normalizeFeatureType('Pass'), 'pass', 'ss words stay singular');
  assert.equal(normalizeFeatureType(''), '');
  assert.equal(normalizeFeatureType(undefined), '');
});

test('ranks run Trench < Ridge < plains < fracture zones and escarpments < Seamount', () => {
  const rank = (type) => classifyFeatureType(type).rank;
  const ordered = [
    'Trench',
    'Ridge',
    'Abyssal Plain',
    'Plateau',
    'Rise',
    'Basin',
    'Trough',
    'Fracture Zone',
    'Escarpment',
    'Seamount',
  ];
  for (let i = 1; i < ordered.length; i++)
    assert.ok(rank(ordered[i - 1]) < rank(ordered[i]), ordered[i]);
  const majors = TYPE_TABLE.filter((entry) => entry.kind === 'major');
  assert.deepEqual(
    majors.map((entry) => entry.rank),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    'exactly the first nine ranks are major',
  );
  assert.ok(
    TYPE_TABLE.every((entry) => entry.rank < UNKNOWN_TYPE_RANK),
    'every known type outranks the unknown bucket',
  );
});

test('unknown types fall back to minor, rank 30, other, keeping the raw text', () => {
  assert.deepEqual(classifyFeatureType('Salt Dome Province'), {
    type: 'Salt Dome Province',
    kind: 'minor',
    rank: UNKNOWN_TYPE_RANK,
    family: 'other',
  });
  assert.equal(classifyFeatureType('').type, 'Feature');
  assert.equal(familyForType('Pingos'), 'other');
  assert.equal(familyForType('Trench'), 'trench');
  assert.equal(familyForType('Guyots'), 'high');
  assert.equal(familyForType('Fan'), 'channel');
});

test('every type in the shipped bundle classifies consistently with the stored kind and rank', () => {
  const bundle = JSON.parse(
    readFileSync(
      new URL(
        '../../data/local_data/gebco_gazetteer/seafloor-features.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const families = new Set(SEAFLOOR_FAMILIES);
  const seen = new Map();
  for (const feature of bundle.features) {
    const classified = classifyFeatureType(feature.t);
    assert.ok(families.has(classified.family), feature.t);
    assert.equal(classified.kind, feature.k, `${feature.n} ${feature.t}`);
    assert.equal(classified.rank, feature.r, `${feature.n} ${feature.t}`);
    seen.set(classified.family, (seen.get(classified.family) || 0) + 1);
  }
  // The "other" bucket is rare types only; the table must carry the bulk.
  assert.ok(
    seen.get('other') < bundle.features.length * 0.05,
    `${seen.get('other')} other`,
  );
  for (const family of SEAFLOOR_FAMILIES)
    assert.ok(seen.get(family) > 0, family);
});

test("extent is the longest path's diagonal, longitude shrunk towards the poles", () => {
  assert.equal(featureExtentDegrees(undefined), 0);
  assert.equal(featureExtentDegrees([]), 0);
  assert.equal(featureExtentDegrees([[[0, 0]]]), 0, 'a lone vertex is a point');
  // A 30-degree east-west line at the equator.
  assert.ok(
    Math.abs(
      featureExtentDegrees([
        [
          [-15, 0],
          [15, 0],
        ],
      ]) - 30,
    ) < 1e-9,
  );
  // The same line at 60 degrees north covers half the ground.
  assert.ok(
    Math.abs(
      featureExtentDegrees([
        [
          [-15, 60],
          [15, 60],
        ],
      ]) - 15,
    ) < 1e-9,
  );
  // Split at the antimeridian: the longest piece counts, not the 360-degree box.
  const split = featureExtentDegrees([
    [
      [170, 0],
      [179.999, 0],
    ],
    [
      [-179.999, 0],
      [-160, 0],
    ],
  ]);
  assert.ok(split > 19.9 && split < 20.1, `got ${split}`);
  assert.equal(
    featureExtentDegrees([
      [
        [NaN, 0],
        ['x', 1],
      ],
    ]),
    0,
  );
});

test('prominence takes five ranks off per size tier and can go below 1', () => {
  assert.deepEqual(EXTENT_TIER_DEGREES, [15, 5]);
  assert.equal(EXTENT_TIER_BONUS, 5);
  assert.equal(seafloorProminence(2, 0), 2, 'a point ridge keeps its rank');
  assert.equal(seafloorProminence(2, 4.9), 2);
  assert.equal(seafloorProminence(2, 5), -3);
  assert.equal(
    seafloorProminence(7, 20),
    -3,
    'a 20-degree basin ties a mid ridge',
  );
  assert.equal(seafloorProminence(1, 40), -9, 'a long trench leads everything');
  assert.ok(
    seafloorProminence(7, 20) < seafloorProminence(2, 1),
    'big basin over small ridge',
  );
  assert.equal(seafloorProminence(NaN, 50), UNKNOWN_TYPE_RANK - 10);
  assert.equal(seafloorProminence(3, NaN), 3);
});
