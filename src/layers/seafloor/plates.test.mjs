import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATE_CONTINENTAL_CLASSES,
  PLATE_OCEANIC_CLASSES,
  mergePlateSteps,
  roundPath,
  simplifyPath,
  simplifyRing,
  splitAtAntimeridian,
} from './plates.js';

function step(cls, bound, coords) {
  return {
    type: 'Feature',
    properties: { STEPCLASS: cls, PLATEBOUND: bound },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

test('consecutive same-class steps of a boundary that share an endpoint merge into one segment', () => {
  const segments = mergePlateSteps([
    step('OSR', 'AF-AN', [
      [0, 0],
      [1, 0],
    ]),
    step('OSR', 'AF-AN', [
      [1, 0],
      [2, 0.004],
    ]),
    step('OSR', 'AF-AN', [
      [2, 0.004],
      [3, 0],
    ]),
  ]);
  assert.deepEqual(segments, [
    {
      c: 'OSR',
      p: 'AF-AN',
      v: [
        [0, 0],
        [3, 0],
      ],
    },
  ]);
});

test('a class change, a plate-pair change or a gap closes the run', () => {
  const segments = mergePlateSteps(
    [
      step('OSR', 'AF-AN', [
        [0, 0],
        [1, 1],
      ]),
      step('OTF', 'AF-AN', [
        [1, 1],
        [2, 1],
      ]),
      step('OTF', 'AF-SA', [
        [2, 1],
        [3, 2],
      ]),
      step('OTF', 'AF-SA', [
        [3.5, 2],
        [4, 3],
      ]),
    ],
    { tolerance: 0 },
  );
  assert.equal(segments.length, 4);
  assert.deepEqual(
    segments.map((segment) => [segment.c, segment.p]),
    [
      ['OSR', 'AF-AN'],
      ['OTF', 'AF-AN'],
      ['OTF', 'AF-SA'],
      ['OTF', 'AF-SA'],
    ],
  );
});

test('continental classes are dropped by default and kept on request', () => {
  const steps = [
    step('CRB', 'AF-SO', [
      [30, 0],
      [31, 1],
    ]),
    step('SUB', 'PA-PS', [
      [140, 20],
      [141, 21],
    ]),
  ];
  assert.deepEqual(
    mergePlateSteps(steps).map((segment) => segment.c),
    ['SUB'],
  );
  assert.deepEqual(
    mergePlateSteps(steps, {
      classes: [...PLATE_OCEANIC_CLASSES, ...PLATE_CONTINENTAL_CLASSES],
    }).map((segment) => segment.c),
    ['CRB', 'SUB'],
  );
});

test('vertices round to two decimals and densified great-circle steps collapse to their ends', () => {
  const dense = [];
  for (let i = 0; i <= 40; i++) dense.push([10 + i * 0.01, 5 + i * 0.0025]);
  const [segment] = mergePlateSteps([step('SUB', 'PA-PS', dense)]);
  assert.deepEqual(segment.v, [
    [10, 5],
    [10.4, 5.1],
  ]);
  assert.deepEqual(
    roundPath(
      [
        [1.234567, 2.345678],
        [1.23, 2.35],
        [1.231, 2.349],
      ],
      2,
    ),
    [[1.23, 2.35]],
    'rounding collapses near-duplicates',
  );
});

test('paths split at the antimeridian with the crossing latitude interpolated', () => {
  assert.deepEqual(
    splitAtAntimeridian([
      [170, 0],
      [-170, 10],
      [-160, 10],
    ]),
    [
      [
        [170, 0],
        [180, 5],
      ],
      [
        [-180, 5],
        [-170, 10],
        [-160, 10],
      ],
    ],
  );
  assert.deepEqual(
    splitAtAntimeridian([
      [-179, 0],
      [179, 0],
    ]),
    [
      [
        [-179, 0],
        [-180, 0],
      ],
      [
        [180, 0],
        [179, 0],
      ],
    ],
  );
  const merged = mergePlateSteps([
    step('OTF', 'PA-AN', [
      [179.5, -60],
      [-179.5, -60.1],
    ]),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].v.at(-1)[0], 180);
  assert.equal(merged[1].v[0][0], -180);
});

test('Douglas-Peucker keeps the ends and the vertices that bend', () => {
  assert.deepEqual(
    simplifyPath(
      [
        [0, 0],
        [1, 0.001],
        [2, 0],
        [3, 1],
        [4, 0],
      ],
      0.01,
    ),
    [
      [0, 0],
      [2, 0],
      [3, 1],
      [4, 0],
    ],
  );
  const ring = simplifyRing(
    [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
    0.01,
  );
  assert.deepEqual(ring, [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ]);
  assert.deepEqual(
    simplifyRing(
      [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0],
      ],
      0.02,
    ),
    [],
    'a ring smaller than the tolerance collapses',
  );
});
