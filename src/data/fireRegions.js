/**
 * @module data/fireRegions
 *
 * Count fire detections inside named lon/lat boxes. Pure — no Cesium, no
 * network. A box is a box: the caller labels it as one and never implies a
 * state boundary.
 */

/**
 * Validate a region list into `{id, label, shortLabel, bbox}` rows.
 * A region with a malformed box is dropped rather than counting everything.
 * @param {Array<object>|undefined} regions
 * @returns {Array<{id: string, label: string, shortLabel: string, bbox: object}>}
 */
export function normalizeFireRegions(regions) {
  if (!Array.isArray(regions)) return [];
  const out = [];
  const seen = new Set();
  for (const region of regions) {
    const id = String(region?.id ?? '').trim();
    const bbox = region?.bbox;
    if (!id || seen.has(id) || !bbox || typeof bbox !== 'object') continue;
    const west = Number(bbox.west);
    const south = Number(bbox.south);
    const east = Number(bbox.east);
    const north = Number(bbox.north);
    if (![west, south, east, north].every(Number.isFinite)) continue;
    if (south > north || Math.abs(south) > 90 || Math.abs(north) > 90) continue;
    if (Math.abs(west) > 180 || Math.abs(east) > 180) continue;
    seen.add(id);
    out.push({
      id,
      label: String(region.label ?? id),
      shortLabel: String(region.shortLabel ?? region.label ?? id),
      bbox: { west, south, east, north },
    });
  }
  return out;
}

/**
 * Is a point inside a box? A box crossing the antimeridian has west > east.
 * @param {{lat: number, lon: number}} point
 * @param {{west: number, south: number, east: number, north: number}} bbox
 * @returns {boolean}
 */
export function pointInBbox(point, bbox) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < bbox.south || lat > bbox.north) return false;
  return bbox.west <= bbox.east
    ? lon >= bbox.west && lon <= bbox.east
    : lon >= bbox.west || lon <= bbox.east;
}

/**
 * Detections per region, in the regions' order. One pass over the fires.
 * @param {Array<{lat: number, lon: number}>} fires
 * @param {Array<object>} regions - Raw or normalized regions.
 * @returns {Array<{id: string, label: string, shortLabel: string, count: number}>}
 */
export function countFiresInRegions(fires, regions) {
  const rows = normalizeFireRegions(regions).map((region) => ({
    ...region,
    count: 0,
  }));
  if (rows.length === 0 || !Array.isArray(fires)) {
    return rows.map(({ bbox, ...row }) => row);
  }
  for (const fire of fires) {
    for (const row of rows) {
      if (pointInBbox(fire, row.bbox)) row.count += 1;
    }
  }
  return rows.map(({ bbox, ...row }) => row);
}
