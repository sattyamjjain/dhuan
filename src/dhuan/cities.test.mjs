// The edition's quick places, checked as data the way src/cityPresets.test.mjs
// checks upstream's table: well-formed rows the camera can hold, every
// landmark inside the rectangle its own city opens on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DHUAN_CITIES } from './cities.js';

const CITIES = Object.entries(DHUAN_CITIES);
const REQUIRED_POI_KEYS = ['name', 'lat', 'lon', 'alt', 'pitch', 'heading'];
const where = (id, poi) => `${id} · ${poi.name}`;

test('every city is named, bounded, and offers landmarks', () => {
  assert.ok(CITIES.length >= 4);
  for (const [id, city] of CITIES) {
    assert.ok(city.name.trim().length > 0, `${id} has no name`);
    assert.ok(Number.isFinite(city.groundElevation), `${id} ground elevation`);
    assert.ok(city.viewBounds?.southwest && city.viewBounds?.northeast, id);
    assert.ok(city.pois.length > 0, `${id} has no POIs`);
  }
});

test('every landmark carries the keys the camera reads, with sane values', () => {
  for (const [id, city] of CITIES) {
    for (const poi of city.pois) {
      for (const key of REQUIRED_POI_KEYS) {
        assert.notEqual(poi[key], undefined, `${where(id, poi)} misses ${key}`);
      }
      assert.ok(poi.lat > 6 && poi.lat < 37, `${where(id, poi)} lat in India`);
      assert.ok(poi.lon > 68 && poi.lon < 98, `${where(id, poi)} lon in India`);
      assert.ok(poi.alt > 100 && poi.alt < 5000, `${where(id, poi)} range`);
      assert.ok(poi.pitch < 0 && poi.pitch > -90, `${where(id, poi)} pitch`);
      assert.ok(
        poi.heading >= 0 && poi.heading < 360,
        `${where(id, poi)} heading`,
      );
    }
  }
});

test('every landmark lies inside its city overview rectangle', () => {
  for (const [id, city] of CITIES) {
    const { southwest, northeast } = city.viewBounds;
    assert.ok(
      southwest.lat < northeast.lat && southwest.lng < northeast.lng,
      id,
    );
    for (const poi of city.pois) {
      assert.ok(
        poi.lat >= southwest.lat && poi.lat <= northeast.lat,
        `${where(id, poi)} latitude outside the overview`,
      );
      assert.ok(
        poi.lon >= southwest.lng && poi.lon <= northeast.lng,
        `${where(id, poi)} longitude outside the overview`,
      );
    }
  }
});

test('city ids and names are unique', () => {
  const names = CITIES.map(([, city]) => city.name);
  assert.equal(new Set(names).size, names.length);
});
