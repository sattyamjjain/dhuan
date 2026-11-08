import * as Cesium from 'cesium';
import { createBundledCurrentSource } from './bundledSource.js';
import { createIngestion } from './ingestion.js';
import { createLifecycle } from './lifecycle.js';
import { createOceanCurrentRendering } from './rendering.js';
import { createState } from './state.js';

/**
 * Construct the ocean currents layer. Nothing is fetched here: the bundle
 * loads on the first enable, so the catalog can be built under Node.
 * @param {object} options
 * @param {{label: string, fetch: function}} [options.source]
 * @param {object} options.overlayHost World-overlay host (setEntries, setVisible, clearSource).
 * @param {object} [options.cesium]
 * @param {function} [options.createRendering] Test seam.
 * @returns {object} Layer descriptor.
 */
export function createOceanCurrentsLayer({
  source = createBundledCurrentSource(),
  overlayHost,
  cesium = Cesium,
  createRendering = createOceanCurrentRendering,
} = {}) {
  if (typeof overlayHost?.setEntries !== 'function')
    throw new TypeError(
      'Ocean currents need an overlay host with setEntries(sourceId, entries)',
    );
  if (typeof source?.fetch !== 'function' || !source.label)
    throw new TypeError(
      'A current source with a label and fetch(signal) is required',
    );
  const state = createState({ overlayHost });
  const parts = {};
  const context = {
    state,
    parts,
    source,
    cesium,
    overlayHost,
    createRendering,
  };
  parts.ingestion = createIngestion(context);
  return createLifecycle(context);
}

export {
  currentColor,
  currentDashCount,
  currentFlowRate,
  currentLabelPriority,
  currentLineWidth,
  currentPathLengthKm,
  currentReferencePoint,
  normalizeCurrentFeatures,
  summarizeCurrents,
  validateCurrentFeature,
} from './model.js';
export {
  createCurrentOverlayEntry,
  createCurrentOverlayPublisher,
  currentOverlayEntries,
} from './overlay.js';
export { createFlowClock } from './animation.js';
export { createBundledCurrentSource } from './bundledSource.js';
export {
  COLD_COLOR,
  DISPLAY_HEIGHT_METERS,
  FADE_HIGH_METERS,
  FADE_LOW_METERS,
  OCEAN_CURRENTS_LAYER_ID,
  OVERLAY_SOURCE_ID,
  WARM_COLOR,
} from './policy.js';
