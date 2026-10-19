import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePanelNaturalHeight } from './panelMeasurement.js';

/** A panel whose inner holds two 100px rows; styles come from the table. */
function fixture(styles) {
  const rect = (top, height) => ({ top, height, bottom: top + height });
  const row = (name, top) => ({
    name,
    classList: { contains: () => false },
    scrollHeight: 100,
    getBoundingClientRect: () => rect(top, 100),
  });
  const rows = [row('a', 10), row('b', 110)];
  const inner = {
    name: 'inner',
    classList: { contains: () => false },
    children: rows,
    getBoundingClientRect: () => rect(0, 220),
  };
  const panel = {
    name: 'panel',
    children: [inner],
    scrollHeight: 222,
    getBoundingClientRect: () => rect(0, 222),
  };
  const base = {
    display: 'block',
    visibility: 'visible',
    paddingTop: '10px',
    paddingBottom: '10px',
    marginBottom: '0px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
  };
  // The panel box itself carries borders but no padding in this fixture, so
  // the expected numbers read as rows + inner padding + 2px of border.
  const panelBox = { paddingTop: '0px', paddingBottom: '0px' };
  const getComputedStyle = (el) => ({
    ...base,
    ...(el.name === 'panel' ? panelBox : {}),
    ...(styles[el.name] || {}),
  });
  return { panel, getComputedStyle };
}

test('a visible panel measures its rows plus padding and borders', () => {
  const { panel, getComputedStyle } = fixture({});
  // 10 padding + rows reaching 210 + 10 padding + 2 border = 222
  assert.equal(measurePanelNaturalHeight(panel, getComputedStyle), 222);
});

test('a panel hidden by a mode still measures its content', () => {
  // recording-mode sets visibility:hidden on the panel; the inner and every
  // row inherit it, and hidden content keeps its layout.
  const { panel, getComputedStyle } = fixture({
    panel: { visibility: 'hidden' },
    inner: { visibility: 'hidden' },
    a: { visibility: 'hidden' },
    b: { visibility: 'hidden' },
  });
  assert.equal(measurePanelNaturalHeight(panel, getComputedStyle), 222);
});

test('a row hidden on its own is not given room', () => {
  const { panel, getComputedStyle } = fixture({ b: { visibility: 'hidden' } });
  // 10 padding + row a reaching 110 + 10 padding + 2 border = 122
  assert.equal(measurePanelNaturalHeight(panel, getComputedStyle), 122);
  const gone = fixture({ b: { display: 'none' } });
  assert.equal(
    measurePanelNaturalHeight(gone.panel, gone.getComputedStyle),
    122,
  );
});
