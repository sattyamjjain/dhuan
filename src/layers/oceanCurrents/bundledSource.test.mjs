import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundledCurrentSource } from './bundledSource.js';

test('the source resolves the bundled asset and forwards the signal', async () => {
  const seen = [];
  const source = createBundledCurrentSource({
    loadJson: async (url, options) => {
      seen.push({ url, options });
      return { type: 'FeatureCollection', features: [] };
    },
  });
  assert.equal(source.label, 'Hand-drawn schematic');
  const controller = new AbortController();
  const json = await source.fetch(controller.signal);
  assert.deepEqual(json, { type: 'FeatureCollection', features: [] });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url instanceof URL);
  assert.ok(
    seen[0].url.pathname.endsWith(
      '/src/data/local_data/ocean_currents/currents.json',
    ),
    seen[0].url.pathname,
  );
  assert.equal(seen[0].options.signal, controller.signal);
  await source.fetch();
  assert.equal(seen[1].options.signal, undefined);
});

test('an aborted signal rejects before and after the read', async () => {
  let reads = 0;
  const controller = new AbortController();
  const source = createBundledCurrentSource({
    loadJson: async () => {
      reads++;
      controller.abort();
      return { features: [] };
    },
  });
  await assert.rejects(source.fetch(controller.signal), { name: 'AbortError' });
  assert.equal(reads, 1, 'the abort landed during the read');
  await assert.rejects(source.fetch(controller.signal), { name: 'AbortError' });
  assert.equal(reads, 1, 'a pre-aborted signal never reads');
});

test('a failed read propagates', async () => {
  const source = createBundledCurrentSource({
    loadJson: async () => {
      throw new Error('HTTP 503 for currents.json');
    },
  });
  await assert.rejects(source.fetch(), /HTTP 503/);
});

test('the default loader reads the real bundle under Node', async () => {
  const json = await createBundledCurrentSource().fetch();
  assert.equal(json.type, 'FeatureCollection');
  assert.equal(json.features.length, 32);
  assert.equal(json.meta.license, 'CC0-1.0');
});
