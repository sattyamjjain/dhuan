import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundledSeafloorSource } from './bundledSource.js';

test('the default source reads both shipped bundles from disk under Node', async () => {
  const source = createBundledSeafloorSource();
  assert.equal(source.label, 'GEBCO Gazetteer');
  const { features, plates } = await source.fetch();
  assert.ok(
    Array.isArray(features.features) && features.features.length > 5000,
  );
  assert.ok(Array.isArray(plates.segments) && plates.segments.length > 1000);
  assert.equal(features.meta.citation.includes('GEBCO'), true);
  assert.equal(plates.meta.license, 'ODC-By 1.0');
});

test('a failing bundle load rejects the whole fetch and asks for both files', async () => {
  const requested = [];
  const source = createBundledSeafloorSource({
    loadJson: async (url) => {
      requested.push(url.pathname.split('/').pop());
      throw new Error('HTTP 503 for ' + url.pathname);
    },
  });
  await assert.rejects(source.fetch(), /HTTP 503/);
  assert.deepEqual(requested.sort(), [
    'plate-boundaries.json',
    'seafloor-features.json',
  ]);
});

test('cancellation during loading cannot return a late snapshot', async () => {
  const controller = new AbortController();
  const source = createBundledSeafloorSource({
    loadJson: async (url, { signal }) => {
      signal.throwIfAborted();
      controller.abort();
      return url.pathname.endsWith('seafloor-features.json')
        ? { features: [] }
        : { segments: [] };
    },
  });
  await assert.rejects(source.fetch(controller.signal), { name: 'AbortError' });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(source.fetch(aborted.signal), { name: 'AbortError' });
});
