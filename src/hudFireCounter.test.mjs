import assert from 'node:assert/strict';
import test from 'node:test';
import { fireCounterForHud } from './hudFireCounter.js';

const row = (overrides = {}) => ({
  id: 'local-firms',
  enabled: true,
  stats: {
    lastUpdate: 1_700_000_000_000,
    keyRequired: false,
    regions: [
      { id: 'punjab-haryana', shortLabel: 'PUNJAB+HARYANA', count: 412 },
    ],
  },
  ...overrides,
});

test('the HUD segment reads the configured region from the fire layer stats', () => {
  assert.deepEqual(fireCounterForHud([row()], 'punjab-haryana'), {
    count: 412,
    label: 'PUNJAB+HARYANA',
  });
});

test('nothing honest to show is null, never zero', () => {
  assert.equal(fireCounterForHud([row({ enabled: false })], 'punjab-haryana'), null);
  assert.equal(
    fireCounterForHud([row({ stats: { lastUpdate: null, regions: [] } })], 'punjab-haryana'),
    null,
  );
  assert.equal(
    fireCounterForHud(
      [row({ stats: { lastUpdate: 1, keyRequired: true, regions: [{ id: 'punjab-haryana', count: 3 }] } })],
      'punjab-haryana',
    ),
    null,
  );
  assert.equal(fireCounterForHud([row()], 'delhi'), null);
  assert.equal(fireCounterForHud([], 'punjab-haryana'), null);
  assert.equal(fireCounterForHud(undefined, 'punjab-haryana'), null);
});
