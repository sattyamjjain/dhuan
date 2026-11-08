/**
 * @file Generic feature types of the GEBCO Gazetteer, reduced to a small
 * table the layer can colour, rank and gate by.
 *
 * The gazetteer carries ~80 distinct TYPE spellings (plurals, "Seamount
 * Chain", "Abyssal Hills", "Sea Channel", "Tablemount"). This module is pure
 * so the fetch script classifies at build time and the renderer never has to
 * re-derive it from the raw strings.
 *
 * @module layers/seafloor/classification
 */

/** Colour family keys; the palette lives in policy.js. */
export const SEAFLOOR_FAMILIES = Object.freeze([
  'trench',
  'ridge',
  'plain',
  'fracture',
  'plateau',
  'high',
  'channel',
  'other',
]);

/** Rank of every type the table does not know; also its kind and family. */
export const UNKNOWN_TYPE_RANK = 30;

/**
 * Canonical singular type, rank (lower = more important), kind and family.
 * Ranks 1 to 9 are the major kinds: they get polygon outlines and labels at
 * every zoom. Everything else is minor: anchor only, named up close. Fracture
 * zones and escarpments close the major list: they are long, numerous lines
 * that would otherwise crowd the basins out of the globe-scale label budget.
 */
export const TYPE_TABLE = Object.freeze(
  [
    ['Trench', 1, 'major', 'trench'],
    ['Ridge', 2, 'major', 'ridge'],
    ['Abyssal Plain', 3, 'major', 'plain'],
    ['Plateau', 4, 'major', 'plateau'],
    ['Rise', 5, 'major', 'ridge'],
    ['Basin', 6, 'major', 'plain'],
    ['Trough', 7, 'major', 'trench'],
    ['Fracture Zone', 8, 'major', 'fracture'],
    ['Escarpment', 9, 'major', 'fracture'],
    ['Seamount', 10, 'minor', 'high'],
    ['Guyot', 11, 'minor', 'high'],
    ['Canyon', 12, 'minor', 'channel'],
    ['Bank', 13, 'minor', 'plateau'],
    ['Shelf', 14, 'minor', 'plateau'],
    ['Slope', 15, 'minor', 'plateau'],
    ['Knoll', 16, 'minor', 'high'],
    ['Hill', 17, 'minor', 'high'],
    ['Reef', 18, 'minor', 'high'],
    ['Shoal', 19, 'minor', 'high'],
    ['Fan', 20, 'minor', 'channel'],
    ['Hole', 21, 'minor', 'channel'],
    ['Spur', 22, 'minor', 'channel'],
    ['Valley', 23, 'minor', 'channel'],
    ['Gap', 24, 'minor', 'channel'],
    ['Passage', 25, 'minor', 'channel'],
    ['Sill', 26, 'minor', 'channel'],
    ['Channel', 27, 'minor', 'channel'],
    ['Deep', 28, 'minor', 'trench'],
    ['Scarp', 29, 'minor', 'fracture'],
  ].map(([type, rank, kind, family]) =>
    Object.freeze({ type, rank, kind, family }),
  ),
);

const TYPE_BY_KEY = new Map(
  TYPE_TABLE.map((entry) => [entry.type.toLowerCase(), entry]),
);

/** Spellings the gazetteer uses for a type the table knows under another name. */
const SYNONYMS = Object.freeze({
  'abyssal hill': 'hill',
  'mid ocean ridge': 'ridge',
  'seamount chain': 'seamount',
  'seamount group': 'seamount',
  tablemount: 'guyot',
  'sea channel': 'channel',
  seachannel: 'channel',
  'sea valley': 'valley',
  'continental slope': 'slope',
  plain: 'abyssal plain',
});

/** Regional qualifiers that name a group of the head type. */
const GROUP_SUFFIX = /\s+(?:province|system|group|chain)$/;

/**
 * Lower-case singular lookup key for a raw gazetteer TYPE.
 * @param {string} raw
 * @returns {string} '' when nothing usable remains.
 */
export function normalizeFeatureType(raw) {
  let key = String(raw ?? '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!key) return '';
  if (SYNONYMS[key]) return SYNONYMS[key];
  key = key.replace(GROUP_SUFFIX, '');
  if (SYNONYMS[key]) return SYNONYMS[key];
  // Singularise the last word only: "Fracture Zones" -> "fracture zone",
  // "Seamounts" -> "seamount". Words ending in "ss" (Pass) are already singular.
  key = key.replace(/([a-z])s$/, (match, before) =>
    before === 's' ? match : before,
  );
  return SYNONYMS[key] ?? key;
}

/**
 * Classify one raw gazetteer TYPE string.
 * @param {string} raw TYPE attribute as served.
 * @returns {{type:string,kind:'major'|'minor',rank:number,family:string}}
 */
export function classifyFeatureType(raw) {
  const key = normalizeFeatureType(raw);
  const known = TYPE_BY_KEY.get(key);
  if (known) return { ...known };
  const fallback = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    type: fallback || 'Feature',
    kind: 'minor',
    rank: UNKNOWN_TYPE_RANK,
    family: 'other',
  };
}

/**
 * Colour family for a canonical or raw type.
 * @param {string} type
 * @returns {string} One of SEAFLOOR_FAMILIES.
 */
export function familyForType(type) {
  return classifyFeatureType(type).family;
}

/**
 * Size tiers, in degrees of drawn extent, that lift a feature above its type
 * rank: a 40-degree ridge or basin matters more at globe scale than a
 * 1-degree trench segment. Each tier takes five ranks off.
 */
export const EXTENT_TIER_DEGREES = Object.freeze([15, 5]);

/** Ranks removed per extent tier crossed. */
export const EXTENT_TIER_BONUS = 5;

/**
 * Drawn extent of a feature in degrees: the largest bounding-box diagonal
 * over its paths, longitude scaled by the cosine of the mid latitude. The
 * longest path alone, so a feature split at the antimeridian does not read
 * as 360 degrees wide. Points have no extent.
 * @param {number[][][]} paths Arrays of [lon, lat] vertices.
 * @returns {number}
 */
export function featureExtentDegrees(paths) {
  if (!Array.isArray(paths)) return 0;
  let best = 0;
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < 2) continue;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const vertex of path) {
      const lon = Number(vertex?.[0]);
      const lat = Number(vertex?.[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) continue;
    const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const extent = Math.hypot(
      (maxLon - minLon) * Math.cos(midLat),
      maxLat - minLat,
    );
    if (extent > best) best = extent;
  }
  return best;
}

/**
 * Label importance: the type rank, less five per size tier the drawn extent
 * crosses. Lower is more important; the result can go below 1.
 * @param {number} rank
 * @param {number} [extentDeg]
 * @returns {number}
 */
export function seafloorProminence(rank, extentDeg = 0) {
  const base = Number.isFinite(rank) ? rank : UNKNOWN_TYPE_RANK;
  if (!(extentDeg > 0)) return base;
  let tiers = 0;
  for (const threshold of EXTENT_TIER_DEGREES)
    if (extentDeg >= threshold) tiers++;
  return base - tiers * EXTENT_TIER_BONUS;
}
