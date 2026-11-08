import * as Cesium from 'cesium';
import { SEAFLOOR_GLOBE_STACK_IDS } from './policy.js';

/**
 * Ground-line classification for one map stack. The photoreal stack renders
 * Google 3D tiles with the Cesium globe HIDDEN, so the lines only need the
 * 3D-tile pass there; every known imagery stack renders on the shown globe,
 * so only the terrain pass applies. BOTH is the safe fallback for a stack
 * this module has never heard of.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function seafloorClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (SEAFLOOR_GLOBE_STACK_IDS.has(activeId))
    return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state. The boot-time
 * `setStack(..., { silent: true })` fires no 'gev:map-stack-changed' event,
 * so the initial classification reads the scene: photoreal is exactly
 * "globe hidden".
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function seafloorClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}
