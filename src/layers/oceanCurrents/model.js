import {
  COLD_COLOR,
  COLD_LINE_WIDTH_PX,
  DASH_SPACING_KM,
  EARTH_RADIUS_KM,
  FLOW_RATE_PER_SECOND,
  LABEL_PRIORITY,
  SPEED_CLASS_RATE,
  VALID_BASINS,
  VALID_RANKS,
  VALID_SPEED_CLASSES,
  VALID_TEMPS,
  WARM_COLOR,
  WARM_LINE_WIDTH_PX,
} from './policy.js';

const ID_PATTERN = /^[a-z0-9-]+$/;
const MIN_VERTICES = 4;

/** Feature id: GeoJSON allows it on the feature or in its properties. */
function featureId(feature) {
  return feature?.id ?? feature?.properties?.id;
}

/** One [lon, lat] pair is usable when finite and inside the authored range. */
function coordinateProblem(pair, index) {
  if (!Array.isArray(pair) || pair.length < 2)
    return `coordinate ${index} is not a [lon, lat] pair`;
  const [lon, lat] = pair;
  if (!Number.isFinite(lon) || !Number.isFinite(lat))
    return `coordinate ${index} is not finite`;
  if (lon < -180 || lon >= 360)
    return `coordinate ${index} longitude ${lon} is outside [-180, 360)`;
  if (lat < -90 || lat > 90)
    return `coordinate ${index} latitude ${lat} is outside [-90, 90]`;
  return null;
}

function geometryProblems(geometry) {
  const problems = [];
  if (geometry?.type !== 'LineString') return ['geometry must be a LineString'];
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < MIN_VERTICES)
    return [`needs at least ${MIN_VERTICES} vertices`];
  for (let i = 0; i < coordinates.length; i++) {
    const problem = coordinateProblem(coordinates[i], i);
    if (problem) {
      problems.push(problem);
      continue;
    }
    // A long jump means the author wrapped across the antimeridian; the
    // schematic rule is continuous longitudes past 180 instead.
    if (i > 0 && Array.isArray(coordinates[i - 1])) {
      const step = Math.abs(coordinates[i][0] - coordinates[i - 1][0]);
      if (Number.isFinite(step) && step >= 180)
        problems.push(`longitude jumps ${step} degrees at vertex ${i}`);
    }
  }
  return problems;
}

/**
 * Describe everything wrong with one authored feature; empty when valid.
 * @param {object} feature GeoJSON Feature.
 * @returns {string[]} Human-readable problems.
 */
export function validateCurrentFeature(feature) {
  const problems = [];
  const id = featureId(feature);
  if (typeof id !== 'string' || !ID_PATTERN.test(id))
    problems.push('id must match /^[a-z0-9-]+$/');
  const props = feature?.properties ?? {};
  if (typeof props.name !== 'string' || !props.name.trim())
    problems.push('name is required');
  if (!VALID_TEMPS.has(props.temp)) problems.push('temp must be warm or cold');
  if (!VALID_BASINS.has(props.basin))
    problems.push('basin must be atlantic, pacific, indian or southern');
  if (
    props.speedClass !== undefined &&
    !VALID_SPEED_CLASSES.has(props.speedClass)
  )
    problems.push('speedClass must be fast, moderate or slow');
  if (props.rank !== undefined && !VALID_RANKS.has(props.rank))
    problems.push('rank must be 1 or 2');
  problems.push(...geometryProblems(feature?.geometry));
  return problems;
}

/** Hex colour for a temperature class. */
export function currentColor(temp) {
  return temp === 'cold' ? COLD_COLOR : WARM_COLOR;
}

/** Line width for a temperature class; a second cue beside the colour. */
export function currentLineWidth(temp) {
  return temp === 'cold' ? COLD_LINE_WIDTH_PX : WARM_LINE_WIDTH_PX;
}

/** Dash advance per second; an unknown class moves at the moderate rate. */
export function currentFlowRate(speedClass) {
  const multiplier = Object.hasOwn(SPEED_CLASS_RATE, speedClass)
    ? SPEED_CLASS_RATE[speedClass]
    : SPEED_CLASS_RATE.moderate;
  return FLOW_RATE_PER_SECOND * multiplier;
}

/** Great-circle length of a [lon, lat] path in kilometres. */
export function currentPathLengthKm(coordinates) {
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    total += 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

/** Moving dashes per current: uniform spacing, never fewer than two. */
export function currentDashCount(lengthKm) {
  return Math.max(2, Math.round(lengthKm / DASH_SPACING_KM));
}

/** The vertex the label hangs from: the middle one. */
export function currentReferencePoint(coordinates) {
  return coordinates[Math.floor(coordinates.length / 2)];
}

/** Overlay arbiter priority by rank; unknown ranks read as secondary. */
export function currentLabelPriority(rank) {
  return Object.hasOwn(LABEL_PRIORITY, rank)
    ? LABEL_PRIORITY[rank]
    : LABEL_PRIORITY[2];
}

function toRecord(feature) {
  const props = feature.properties;
  const coordinates = feature.geometry.coordinates.map(([lon, lat]) => [
    lon,
    lat,
  ]);
  const lengthKm = currentPathLengthKm(coordinates);
  const speedClass = VALID_SPEED_CLASSES.has(props.speedClass)
    ? props.speedClass
    : 'moderate';
  const rank = VALID_RANKS.has(props.rank) ? props.rank : 2;
  return {
    id: featureId(feature),
    name: props.name.trim(),
    temp: props.temp,
    basin: props.basin,
    speedClass,
    rank,
    coordinates,
    lengthKm,
    dashCount: currentDashCount(lengthKm),
    rate: currentFlowRate(speedClass),
    reference: currentReferencePoint(coordinates),
  };
}

/**
 * Validate a FeatureCollection and build renderer records from it.
 * @param {object} json GeoJSON FeatureCollection.
 * @returns {object[]} Records in file order.
 * @throws {TypeError} Naming the first invalid or duplicated feature.
 */
export function normalizeCurrentFeatures(json) {
  if (!Array.isArray(json?.features))
    throw new TypeError('Ocean currents need a GeoJSON FeatureCollection');
  const seen = new Set();
  return json.features.map((feature, index) => {
    const problems = validateCurrentFeature(feature);
    const label = featureId(feature) ?? `#${index}`;
    if (problems.length)
      throw new TypeError(`Ocean current ${label}: ${problems.join('; ')}`);
    if (seen.has(label))
      throw new TypeError(`Ocean current ${label}: duplicate id`);
    seen.add(label);
    return toRecord(feature);
  });
}

/**
 * Counts for the legend, by current name rather than by line: the Antarctic
 * Circumpolar Current is three sector features but one current.
 * @param {object[]} records
 * @returns {{total: number, warm: number, cold: number, features: number}}
 */
export function summarizeCurrents(records) {
  const list = Array.isArray(records) ? records : [];
  const names = { warm: new Set(), cold: new Set() };
  for (const record of list) names[record.temp]?.add(record.name);
  const warm = names.warm.size;
  const cold = names.cold.size;
  return { total: warm + cold, warm, cold, features: list.length };
}
