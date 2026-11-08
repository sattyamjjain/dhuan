/**
 * @file Tunables and identifiers for the sea floor features layer.
 * @module layers/seafloor/policy
 */

export const SEAFLOOR_LAYER_ID = 'seafloor-features';

/** Shared world-overlay source id (matches the layer id). */
export const SEAFLOOR_OVERLAY_SOURCE_ID = SEAFLOOR_LAYER_ID;

/** Bounded nearest-visible cohort the layer offers the shared host. */
export const SEAFLOOR_LABEL_WINNER_CAP = 160;

/** Shared ambient-label paint budget, matching the infrastructure sources. */
export const SEAFLOOR_OVERLAY_COLLISION_CAPACITY = 96;

/**
 * Labels beyond this camera distance are never offered to the host. Wide
 * enough that a camera parked at 14,000 km (the whole globe in frame) still
 * names the near hemisphere; the limb at 20,000 km falls outside it.
 */
export const SEAFLOOR_LABEL_MAX_DISTANCE_M = 22_000_000;

/**
 * At or above this camera height only the anchors whose names are on screen
 * stay visible, so every dot at global framing has a label. Matches the
 * shared infrastructure LOD boundary where the label budget drops to 80.
 */
export const SEAFLOOR_NAMED_ANCHORS_ONLY_HEIGHT_M = 3_000_000;

/**
 * Above this camera height the minor features (2,000+ seamounts, canyons,
 * banks) hide their anchors and labels unless the user asks for every name.
 * Between here and the named-anchors boundary the view holds every major
 * anchor plus the lines; above it, only the named ones.
 */
export const SEAFLOOR_MINOR_CAMERA_HEIGHT_M = 2_500_000;

/** Map stack id of the GEBCO shaded-relief basemap the row chip switches to. */
export const GEBCO_STACK_ID = 'gebco';

/** Stack the chip returns to when no previous stack was observed. */
export const SEAFLOOR_FALLBACK_STACK_ID = 'esri-imagery';

/**
 * Colour per classification family. Shared palette with the ocean currents
 * layer (nothing here uses the currents' orange or sky blue), lightened after
 * the accessibility review so ridges and fracture zones hold contrast on the
 * dark relief basemap.
 */
export const SEAFLOOR_FAMILY_COLORS = Object.freeze({
  trench: '#8b7cff',
  ridge: '#ffa3cf',
  plain: '#8fa3b8',
  fracture: '#dcdcdc',
  plateau: '#c9a66b',
  high: '#ffd84d',
  channel: '#3ccfcf',
  other: '#9aa0a6',
});

/**
 * Families whose ground lines are dashed. Colour alone cannot separate the
 * light-grey fracture zones from transform faults for every viewer; the dash
 * does.
 */
export const SEAFLOOR_DASHED_FAMILIES = Object.freeze(new Set(['fracture']));

/** PB2002 step classes: spreading ridge, subduction zone, transform fault. */
export const PLATE_CLASS_COLORS = Object.freeze({
  OSR: '#ffa3cf',
  SUB: '#a394ff',
  OTF: '#d9d9d9',
});

/**
 * Subduction lines are dashed so a protan viewer tells the indigo from the
 * ridge pink by pattern, not hue.
 */
export const PLATE_DASHED_CLASSES = Object.freeze(new Set(['SUB']));

/** Dash length in pixels for every dashed line of the layer. */
export const SEAFLOOR_DASH_LENGTH_PX = 16;

/** Transform faults are context, so they sit back a little. */
export const PLATE_CLASS_ALPHA = Object.freeze({
  OSR: 0.9,
  SUB: 0.9,
  OTF: 0.6,
});

/**
 * How long the Sea floor map chip reads busy after a request if no
 * 'gev:map-stack-changed' arrives (the shell may refuse or fall back).
 */
export const SEAFLOOR_MAP_REQUEST_TIMEOUT_MS = 8000;

export const PLATE_LINE_WIDTH = 1.6;

export const SEAFLOOR_LINE_WIDTH = 1.8;

export const SEAFLOOR_LINE_ALPHA = 0.7;

/** Polygon outlines are drawn for major kinds only (basins, plateaus, plains). */
export const SEAFLOOR_OUTLINE_WIDTH = 1.2;

export const SEAFLOOR_OUTLINE_ALPHA = 0.35;

export const SEAFLOOR_ANCHOR_PIXEL_SIZE = Object.freeze({ major: 7, minor: 5 });

export const SEAFLOOR_ANCHOR_ALPHA = Object.freeze({
  major: 0.92,
  minor: 0.82,
});

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist, like the cables layer's: an unknown stack degrades to BOTH
 * (visible on every surface) rather than vanishing. `gebco` is listed ahead
 * of its catalog entry so the stack lands classified on day one.
 */
export const SEAFLOOR_GLOBE_STACK_IDS = Object.freeze(
  new Set([
    'bing-aerial',
    'bing-labels',
    'esri-imagery',
    GEBCO_STACK_ID,
    'osm',
  ]),
);

export const SEAFLOOR_NAME_MODES = Object.freeze(['major', 'all']);

export const SEAFLOOR_DEFAULT_PARAMS = Object.freeze({
  plates: true,
  names: 'major',
});

/** Legend order; labels are resolved with t() where the rows are built. */
export const SEAFLOOR_LEGEND_FAMILIES = Object.freeze([
  'trench',
  'ridge',
  'plain',
  'fracture',
  'plateau',
  'high',
  'channel',
  'other',
]);

export const PLATE_LEGEND_CLASSES = Object.freeze(['OSR', 'SUB', 'OTF']);

/**
 * Monotonic clock for the sweep gate's motion probe.
 * @returns {number}
 */
export function defaultSweepClock() {
  return typeof performance === 'object' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
