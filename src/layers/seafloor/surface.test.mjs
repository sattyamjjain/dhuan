import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { MAP_STACKS } from '../../maps/catalog.js';
import {
  seafloorClassificationTypeForScene,
  seafloorClassificationTypeForStack,
} from './surface.js';
import { GEBCO_STACK_ID, SEAFLOOR_GLOBE_STACK_IDS } from './policy.js';

test('every catalog stack classifies onto exactly one surface, never BOTH', () => {
  for (const stack of MAP_STACKS) {
    const type = seafloorClassificationTypeForStack(stack.id);
    assert.notEqual(type, Cesium.ClassificationType.BOTH, stack.id);
    assert.equal(
      type,
      stack.id === 'photoreal'
        ? Cesium.ClassificationType.CESIUM_3D_TILE
        : Cesium.ClassificationType.TERRAIN,
      stack.id,
    );
  }
});

test('the GEBCO stack is classified onto the terrain before it joins the catalog', () => {
  assert.ok(SEAFLOOR_GLOBE_STACK_IDS.has(GEBCO_STACK_ID));
  assert.equal(
    seafloorClassificationTypeForStack(GEBCO_STACK_ID),
    Cesium.ClassificationType.TERRAIN,
  );
});

test('unknown stacks fall back to BOTH and the scene decides at boot', () => {
  assert.equal(
    seafloorClassificationTypeForStack('never-heard-of-it'),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    seafloorClassificationTypeForStack(null),
    Cesium.ClassificationType.BOTH,
  );
  assert.equal(
    seafloorClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    seafloorClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(
    seafloorClassificationTypeForScene(null),
    Cesium.ClassificationType.BOTH,
  );
});
