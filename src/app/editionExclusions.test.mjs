import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceServices } from './surfaceServices.js';
import {
  createApplicationCatalog,
  excludeLayerFromEdition,
} from './constructCatalog.js';
import { catalogControlServices } from './catalog.js';
import { createStandaloneLayerSources } from '../standalone/layerSources.js';
import { LayerLifecycle } from '../data/lifecycle.js';
import { EDITION, isExcludedLayerId } from '../edition.js';

function fixtureSources() {
  const sources = createStandaloneLayerSources();
  sources.military = {
    getSnapshot: async () => {
      throw new Error('Use identity acquisition');
    },
    async getIdentities() {
      return [];
    },
  };
  return sources;
}

function fixtureSurface(signal) {
  return createSurfaceServices({
    terrainSource: { getHeights: async () => [] },
    signal,
    eventTarget: null,
  });
}

test('the edition names the five layers it keeps out, and no others', () => {
  assert.deepEqual(
    [...EDITION.excludedLayerIds],
    ['military', 'military-awareness', 'military-installations', 'cctv', 'alpr-cameras'],
  );
  assert.equal(isExcludedLayerId('cctv'), true);
  assert.equal(isExcludedLayerId('local-firms'), false);
  assert.equal(isExcludedLayerId(undefined), false);
});

test('excluded layers stay registered but are hidden, flagged and refused', async (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = createApplicationCatalog({
    sources: fixtureSources(),
    signal: lifetime.signal,
    surface: fixtureSurface(lifetime.signal),
  });
  // Still 32 instances: the token ledger and control surface need them.
  assert.equal(catalog.layers.length, 32);
  assert.ok(catalogControlServices(catalog).cctvLayer, 'the control surface still binds');

  const lifecycle = new LayerLifecycle({});
  for (const layer of catalog.layers) lifecycle.register(layer);
  const rows = lifecycle.getAll();
  for (const id of EDITION.excludedLayerIds) {
    const row = rows.find((candidate) => candidate.id === id);
    assert.ok(row, `${id} is registered`);
    assert.equal(row.showInTogglePanel, false, `${id} is hidden from the panel`);
    assert.equal(catalog.get(id).excludedFromEdition, 'dhuan');
    const outcome = await lifecycle.setEnabled(id, true, { origin: 'share' });
    assert.equal(outcome, false, `${id} refuses to enable`);
    assert.equal(lifecycle.isEnabled(id), false);
  }
  for (const id of ['local-firms', 'wind', 'air-quality']) {
    const row = rows.find((candidate) => candidate.id === id);
    assert.equal(row.showInTogglePanel, true, `${id} is shown`);
    assert.equal(catalog.get(id).excludedFromEdition, undefined);
  }
});

test('the fire layer counts the edition region and the air-quality layer is CPCB', (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = createApplicationCatalog({
    sources: fixtureSources(),
    signal: lifetime.signal,
    surface: fixtureSurface(lifetime.signal),
  });
  assert.equal(catalog.get('air-quality').source, 'CPCB · data.gov.in');
  assert.equal(catalog.get('air-quality').requiresKeyId, 'cpcb');
  assert.deepEqual(catalog.get('local-firms').getStats().regions, []);
  assert.equal(catalog.get('local-firms').getRowControls(), null);
});

test('a frozen module cannot be excluded quietly', () => {
  const frozen = Object.freeze({ id: 'frozen' });
  assert.throws(() => excludeLayerFromEdition(frozen), TypeError);
  const plain = { id: 'plain', enable() {} };
  excludeLayerFromEdition(plain, 'test');
  assert.equal(plain.showInTogglePanel, false);
  assert.equal(plain.excludedFromEdition, 'test');
  assert.equal(typeof plain.enable, 'function');
});
