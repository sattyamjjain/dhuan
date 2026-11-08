export const OCEAN_CURRENTS_LAYER_ID = 'ocean-currents';

/** Shared ocean palette: warm currents orange, cold currents sky blue. */
export const WARM_COLOR = '#ff8c42';
export const COLD_COLOR = '#4da3ff';

/**
 * Lift above the ellipsoid. The schematic is a textbook drawing, not a surface
 * measurement, so it floats like the wind curves rather than clamping to
 * terrain; the lift also keeps it clear of photoreal tiles.
 */
export const DISPLAY_HEIGHT_METERS = 12_000;

/**
 * Camera heights between which the drawing fades out. A 12 km-lifted sketch of
 * a 5,000 km feature is wrong up close, so the layer disappears below ~200 km.
 */
export const FADE_LOW_METERS = 200_000;
export const FADE_HIGH_METERS = 500_000;

/**
 * Warm and cold differ in geometry as well as hue, so greyscale and tritan
 * viewers still tell them apart: warm lines are wider with a longer dash
 * tail, cold lines narrower with a shorter one.
 */
export const WARM_LINE_WIDTH_PX = 3.2;
export const COLD_LINE_WIDTH_PX = 2.4;
export const WARM_TAIL_FRACTION = 0.45;
export const COLD_TAIL_FRACTION = 0.25;

/** Where a label's keyboard activation flies the camera: globe scale, straight down. */
export const ACTIVATE_HEIGHT_METERS = 5_000_000;
export const ACTIVATE_FLIGHT_SECONDS = 1.2;

/**
 * One moving dash per this many kilometres of path, so every current carries
 * dashes at the same spacing and the same km/s regardless of its length.
 */
export const DASH_SPACING_KM = 1_200;

/** Base dash advance in path fractions per second. */
export const FLOW_RATE_PER_SECOND = 0.12;

export const SPEED_CLASS_RATE = Object.freeze({
  fast: 1.5,
  moderate: 1,
  slow: 0.65,
});

/**
 * GEODESIC with per-vertex heights: a straight 10 degree chord sags about
 * 24 km below the ellipsoid, more than the 12 km lift, so chords would dip
 * underground. Half a degree keeps the arc close to the surface.
 */
export const GEODESIC_GRANULARITY_RAD = Math.PI / 360;

/** Static dash alpha; brighter when paused so direction still reads at rest. */
export const GHOST_ALPHA_RUNNING = 0.28;
export const GHOST_ALPHA_PAUSED = 0.42;

/** Frames closer together than this are skipped (30 Hz cap, wind precedent). */
export const FLOW_FRAME_INTERVAL_SECONDS = 0.032;

export const LABEL_MAX_DISTANCE_M = 45_000_000;
export const LABEL_PRIORITY = Object.freeze({ 1: 900, 2: 800 });
export const OVERLAY_SOURCE_ID = OCEAN_CURRENTS_LAYER_ID;
export const OVERLAY_COHORT_LIMIT = 40;
export const OVERLAY_COLLISION_CAPACITY = 32;

export const VALID_TEMPS = Object.freeze(new Set(['warm', 'cold']));
export const VALID_BASINS = Object.freeze(
  new Set(['atlantic', 'pacific', 'indian', 'southern']),
);
export const VALID_SPEED_CLASSES = Object.freeze(
  new Set(['fast', 'moderate', 'slow']),
);
export const VALID_RANKS = Object.freeze(new Set([1, 2]));

/** Mean Earth radius for the haversine path length. */
export const EARTH_RADIUS_KM = 6371;
