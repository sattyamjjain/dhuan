import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { PLATE_OCEANIC_CLASSES } from './plates.js';

const GAZETTEER_DIR = new URL(
  '../../data/local_data/gebco_gazetteer/',
  import.meta.url,
);
const PLATES_DIR = new URL(
  '../../data/local_data/pb2002_plate_boundaries/',
  import.meta.url,
);
const GAZETTEER_BUDGET = 900 * 1024;
const PLATES_BUDGET = 180 * 1024;

const read = (dir, name) => readFileSync(new URL(name, dir), 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const gazetteerText = read(GAZETTEER_DIR, 'seafloor-features.json');
const gazetteer = JSON.parse(gazetteerText);
const platesText = read(PLATES_DIR, 'plate-boundaries.json');
const plates = JSON.parse(platesText);

test('both bundles stay within their size budgets', () => {
  const gazetteerBytes = statSync(
    new URL('seafloor-features.json', GAZETTEER_DIR),
  ).size;
  const platesBytes = statSync(
    new URL('plate-boundaries.json', PLATES_DIR),
  ).size;
  assert.ok(
    gazetteerBytes <= GAZETTEER_BUDGET,
    `${gazetteerBytes} > ${GAZETTEER_BUDGET}`,
  );
  assert.ok(platesBytes <= PLATES_BUDGET, `${platesBytes} > ${PLATES_BUDGET}`);
});

test('the gazetteer meta counts add up and every feature carries the schema keys', () => {
  const { counts } = gazetteer.meta;
  assert.equal(
    counts.point + counts.line + counts.polygon,
    gazetteer.features.length,
  );
  assert.equal(
    gazetteer.meta.citation,
    'IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net',
  );
  const byGeometry = { p: 0, l: 0, y: 0 };
  for (const feature of gazetteer.features) {
    for (const key of ['n', 't', 'k', 'r', 'g', 'a'])
      assert.ok(
        feature[key] !== undefined && feature[key] !== '',
        `${key} on ${JSON.stringify(feature).slice(0, 80)}`,
      );
    assert.ok(['major', 'minor'].includes(feature.k));
    assert.ok(Number.isInteger(feature.r) && feature.r >= 1);
    assert.ok(feature.g in byGeometry, feature.g);
    byGeometry[feature.g]++;
    const [lon, lat] = feature.a;
    assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, feature.n);
    if (feature.g === 'p') assert.equal(feature.c, undefined);
    else {
      assert.ok(Array.isArray(feature.c) && feature.c.length > 0, feature.n);
      for (const path of feature.c) {
        assert.ok(path.length >= 2);
        for (let i = 1; i < path.length; i++)
          assert.ok(
            Math.abs(path[i][0] - path[i - 1][0]) <= 180,
            `${feature.n} crosses the antimeridian unsplit`,
          );
      }
    }
  }
  assert.deepEqual(byGeometry, {
    p: counts.point,
    l: counts.line,
    y: counts.polygon,
  });
  // Rank-then-name order keeps the diff stable between fetches.
  for (let i = 1; i < gazetteer.features.length; i++)
    assert.ok(gazetteer.features[i - 1].r <= gazetteer.features[i].r);
});

test('the plate bundle holds oceanic classes only, two-decimal vertices and no antimeridian jumps', () => {
  assert.equal(plates.meta.segments, plates.segments.length);
  assert.equal(plates.meta.license, 'ODC-By 1.0');
  assert.match(plates.meta.credit, /Peter Bird/);
  assert.match(plates.meta.credit, /Ahlenius/);
  assert.deepEqual(
    Object.keys(plates.meta.classes).sort(),
    [...PLATE_OCEANIC_CLASSES].sort(),
  );
  const classes = new Set(PLATE_OCEANIC_CLASSES);
  for (const segment of plates.segments) {
    assert.ok(classes.has(segment.c), segment.c);
    assert.equal(typeof segment.p, 'string');
    assert.ok(segment.v.length >= 2);
    for (let i = 0; i < segment.v.length; i++) {
      const [lon, lat] = segment.v[i];
      assert.equal(lon, Math.round(lon * 100) / 100);
      assert.equal(lat, Math.round(lat * 100) / 100);
      if (i > 0)
        assert.ok(
          Math.abs(lon - segment.v[i - 1][0]) <= 180,
          `${segment.p} jumps`,
        );
    }
  }
});

test('source.json records the exact bytes shipped', () => {
  for (const [dir, text, file] of [
    [GAZETTEER_DIR, gazetteerText, 'seafloor-features.json'],
    [PLATES_DIR, platesText, 'plate-boundaries.json'],
  ]) {
    const source = JSON.parse(read(dir, 'source.json'));
    const entry = source.files.find((item) => item.path === file);
    assert.ok(entry, `${file} listed`);
    assert.equal(entry.sha256, sha256(text), `${file} sha256`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(source.downloaded_at));
    assert.ok(read(dir, 'README.md').length > 500);
  }
  const gazetteerSource = JSON.parse(read(GAZETTEER_DIR, 'source.json'));
  assert.equal(
    gazetteerSource.files[0].feature_count,
    gazetteer.features.length,
  );
  assert.match(
    read(GAZETTEER_DIR, 'README.md'),
    /IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www\.gebco\.net/,
  );
  assert.match(read(PLATES_DIR, 'README.md'), /ODC-By 1\.0/);
});
