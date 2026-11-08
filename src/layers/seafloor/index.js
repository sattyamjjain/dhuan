import { createBundledSeafloorSource } from './bundledSource.js';
import { createIngestion } from './ingestion.js';
import { createInteraction } from './interaction.js';
import { createLifecycle } from './lifecycle.js';
import { defaultSweepClock } from './policy.js';
import { createRendering } from './rendering.js';
import { createState } from './state.js';

/**
 * Sea floor features: named trenches, ridges, plains, fracture zones,
 * plateaus, seamounts and canyons from the GEBCO Gazetteer, plus PB2002
 * plate boundaries. Composed like the cables layer: state, rendering,
 * ingestion, interaction and lifecycle parts sharing one context.
 * @param {object} options
 * @param {{label:string,fetch:function}} [options.source] Bundle source; defaults to the shipped bundles.
 * @param {object} options.overlayHost World-overlay host for the labels.
 * @param {function(HTMLCanvasElement):object} [options.screenSpaceEventHandlerFactory]
 * @param {function} [options.registerEntityContext]
 * @param {function} [options.selectEntityContext]
 * @param {function} [options.removeEntityContextsForLayer]
 * @param {function} [options.clearSelectedEntityContextForLayer]
 * @param {EventTarget|null} [options.mapStackEventTarget] Emits 'gev:map-stack-changed'.
 * @param {function(string):void|null} [options.requestMapStack] Asks the shell for a basemap.
 * @param {function():number} [options.sweepClock]
 */
export function createSeafloorFeaturesLayer({
  source = createBundledSeafloorSource(),
  overlayHost,
  screenSpaceEventHandlerFactory,
  registerEntityContext,
  selectEntityContext,
  removeEntityContextsForLayer,
  clearSelectedEntityContextForLayer,
  mapStackEventTarget = null,
  requestMapStack = null,
  sweepClock = defaultSweepClock,
}) {
  if (!source?.fetch || !source.label)
    throw new TypeError(
      'A sea floor source with a label and fetch(signal) is required',
    );
  if (!overlayHost?.setEntries)
    throw new TypeError('A world-overlay host is required');
  const state = createState({ overlayHost, sweepClock });
  const parts = {};
  const context = {
    state,
    parts,
    source,
    screenSpaceEventHandlerFactory,
    registerEntityContext,
    selectEntityContext,
    removeEntityContextsForLayer,
    clearSelectedEntityContextForLayer,
    mapStackEventTarget,
    requestMapStack,
  };
  parts.rendering = createRendering(context);
  parts.ingestion = createIngestion(context);
  parts.interaction = createInteraction(context);
  return createLifecycle(context);
}

export { createBundledSeafloorSource } from './bundledSource.js';
export {
  TYPE_TABLE,
  UNKNOWN_TYPE_RANK,
  classifyFeatureType,
  familyForType,
  normalizeFeatureType,
} from './classification.js';
export {
  PLATE_CONTINENTAL_CLASSES,
  PLATE_OCEANIC_CLASSES,
  mergePlateSteps,
  roundPath,
  simplifyPath,
  simplifyRing,
  splitAtAntimeridian,
} from './plates.js';
export {
  createSeafloorOverlayEntry,
  createSeafloorOverlayPublisher,
  createSeafloorSweepGate,
  minorFeaturesEligible,
  seafloorLabel,
  seafloorLabelCap,
  seafloorLabelPriority,
  seafloorTypeWord,
  selectSeafloorLabelWinners,
} from './overlay.js';
export {
  seafloorClassificationTypeForScene,
  seafloorClassificationTypeForStack,
} from './surface.js';
export {
  GEBCO_STACK_ID,
  PLATE_CLASS_COLORS,
  SEAFLOOR_DEFAULT_PARAMS,
  SEAFLOOR_FAMILY_COLORS,
  SEAFLOOR_GLOBE_STACK_IDS,
  SEAFLOOR_LABEL_MAX_DISTANCE_M,
  SEAFLOOR_LABEL_WINNER_CAP,
  SEAFLOOR_LAYER_ID,
  SEAFLOOR_MINOR_CAMERA_HEIGHT_M,
  SEAFLOOR_OVERLAY_COLLISION_CAPACITY,
  SEAFLOOR_OVERLAY_SOURCE_ID,
} from './policy.js';
