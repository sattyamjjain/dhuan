import test from 'node:test';
import assert from 'node:assert/strict';
import { inkFor, STORY_STRIP_CONTRACT, initStoryStrip } from './storyStrip.js';
import { NAQI_BANDS } from '../layers/airQuality/model.js';

test('badge ink is dark on the light NAQI bands and white on the dark ones', () => {
  const byId = new Map(NAQI_BANDS.map((band) => [band.id, band]));
  assert.equal(inkFor(byId.get('moderate').color), '#101418', 'yellow');
  assert.equal(inkFor(byId.get('satisfactory').color), '#101418', 'light green');
  assert.equal(inkFor(byId.get('severe').color), '#ffffff', 'maroon');
  assert.equal(inkFor(byId.get('very-poor').color), '#ffffff', 'red');
  assert.equal(inkFor('not a colour'), '#ffffff', 'unknown input never throws');
});

test('the strip reads the fire and air layers the panel already shows', () => {
  assert.equal(STORY_STRIP_CONTRACT.FIRE_LAYER_ID, 'local-firms');
  assert.equal(STORY_STRIP_CONTRACT.AIR_LAYER_ID, 'air-quality');
  assert.ok(STORY_STRIP_CONTRACT.REFRESH_MS >= 10_000, 'no hot polling');
});

test('without a root or a data manager the strip mounts nothing', () => {
  assert.equal(initStoryStrip({ root: null, dataManager: {} }), null);
  assert.equal(initStoryStrip({ root: {}, dataManager: null }), null);
});
