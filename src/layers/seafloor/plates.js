/**
 * @file Pure path geometry shared by the data scripts and the layer: PB2002
 * step merging, Douglas-Peucker simplification, rounding, antimeridian split.
 *
 * Nothing here touches Cesium or the DOM, so `scripts/derive-plate-boundaries.mjs`
 * and `scripts/fetch-gebco-gazetteer.mjs` import it under Node and the unit
 * tests exercise the same code the bundles were built with.
 *
 * @module layers/seafloor/plates
 */

/** Oceanic PB2002 step classes: spreading ridge, subduction, transform. */
export const PLATE_OCEANIC_CLASSES = Object.freeze(['OSR', 'SUB', 'OTF']);

/** Continental classes, bundled only with --include-continental. */
export const PLATE_CONTINENTAL_CLASSES = Object.freeze([
  'CRB',
  'CTF',
  'CCB',
  'OCB',
]);

/** Two step endpoints closer than this (degrees) are the same vertex. */
const JOIN_EPSILON_DEG = 1e-6;

function sameVertex(a, b) {
  return (
    Math.abs(a[0] - b[0]) < JOIN_EPSILON_DEG &&
    Math.abs(a[1] - b[1]) < JOIN_EPSILON_DEG
  );
}

/**
 * Round a lon/lat path and drop the consecutive duplicates rounding creates.
 * @param {number[][]} path
 * @param {number} [decimals]
 * @returns {number[][]}
 */
export function roundPath(path, decimals = 2) {
  const factor = 10 ** decimals;
  const out = [];
  for (const vertex of Array.isArray(path) ? path : []) {
    const lon = Math.round(Number(vertex[0]) * factor) / factor;
    const lat = Math.round(Number(vertex[1]) * factor) / factor;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) continue;
    out.push([lon, lat]);
  }
  return out;
}

/**
 * Split a path wherever consecutive longitudes jump by more than 180 degrees,
 * interpolating the crossing latitude so each piece ends exactly on +-180.
 * Cesium draws a chord between such vertices straight across the globe, so a
 * single Pacific trench would otherwise paint a line through Africa.
 * @param {number[][]} path
 * @returns {number[][][]} One or more paths, each free of the jump.
 */
export function splitAtAntimeridian(path) {
  if (!Array.isArray(path) || path.length === 0) return [];
  const pieces = [];
  let current = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [lon0, lat0] = path[i - 1];
    const [lon1, lat1] = path[i];
    if (Math.abs(lon1 - lon0) <= 180) {
      current.push(path[i]);
      continue;
    }
    // Unwrap the second vertex next to the first, find where the segment
    // meets the meridian, then close this piece and start the next.
    const unwrapped = lon1 > lon0 ? lon1 - 360 : lon1 + 360;
    const edge = lon0 > 0 ? 180 : -180;
    const t = (edge - lon0) / (unwrapped - lon0);
    const lat = lat0 + (lat1 - lat0) * (Number.isFinite(t) ? t : 0.5);
    current.push([edge, lat]);
    pieces.push(current);
    current = [[-edge, lat], path[i]];
  }
  pieces.push(current);
  return pieces.filter((piece) => piece.length >= 2);
}

function segmentDistance(p, a, b) {
  let [x, y] = p;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx !== 0 || dy !== 0) {
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy);
    if (t > 1) return Math.hypot(x - b[0], y - b[1]);
    if (t > 0) return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
  }
  return Math.hypot(x - a[0], y - a[1]);
}

/**
 * Iterative Douglas-Peucker over an open path, in the path's own units
 * (degrees here). The first and last vertices always survive.
 * @param {number[][]} points
 * @param {number} tolerance
 * @returns {number[][]}
 */
export function simplifyPath(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2)
    return (points || []).slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Simplify a closed ring. A ring has no chord to measure against, so it is
 * split at the vertex farthest from the start and each half is simplified
 * as an open path. The result is closed (first vertex repeated last).
 * @param {number[][]} ring Closed or open ring.
 * @param {number} tolerance
 * @returns {number[][]} Closed ring, or [] when fewer than 3 distinct vertices remain.
 */
export function simplifyRing(ring, tolerance) {
  let open = Array.isArray(ring) ? ring.slice() : [];
  if (open.length > 1 && sameVertex(open[0], open[open.length - 1]))
    open = open.slice(0, -1);
  if (open.length < 3) return [];
  const first = open[0];
  let far = 1;
  let farDist = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - first[0], open[i][1] - first[1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a = simplifyPath(open.slice(0, far + 1), tolerance);
  const b = simplifyPath([...open.slice(far), first], tolerance);
  const out = [...a, ...b.slice(1)];
  return out.length >= 4 ? out : [];
}

/**
 * Merge consecutive PB2002 steps into boundary segments.
 *
 * Steps arrive in file order along each boundary. A step joins the open run
 * when its PLATEBOUND and STEPCLASS match and its first vertex is the run's
 * last vertex; any other step closes the run. Runs are then simplified
 * (the published steps are densified to ~40 sub-kilometre vertices each,
 * which is 2.4 MB of great-circle interpolation the chord already implies),
 * rounded (which also drops duplicate vertices) and split at the antimeridian.
 * @param {object[]} steps GeoJSON LineString features with PB2002 properties.
 * @param {object} [options]
 * @param {Iterable<string>} [options.classes] STEPCLASS values to keep.
 * @param {number} [options.decimals] Coordinate rounding.
 * @param {number} [options.tolerance] Douglas-Peucker tolerance in degrees; 0 keeps every vertex.
 * @returns {{c:string,p:string,v:number[][]}[]} Segments: class, plate pair, vertices.
 */
export function mergePlateSteps(
  steps,
  { classes = PLATE_OCEANIC_CLASSES, decimals = 2, tolerance = 0.02 } = {},
) {
  const keep = new Set(classes);
  const runs = [];
  let run = null;
  for (const step of Array.isArray(steps) ? steps : []) {
    const props = step?.properties || {};
    const coords = step?.geometry?.coordinates;
    if (
      !keep.has(props.STEPCLASS) ||
      !Array.isArray(coords) ||
      coords.length < 2
    )
      continue;
    const joins =
      run &&
      run.c === props.STEPCLASS &&
      run.p === props.PLATEBOUND &&
      sameVertex(run.v[run.v.length - 1], coords[0]);
    if (joins) {
      run.v.push(...coords.slice(1));
      continue;
    }
    run = {
      c: props.STEPCLASS,
      p: String(props.PLATEBOUND || ''),
      v: coords.slice(),
    };
    runs.push(run);
  }
  const segments = [];
  for (const { c, p, v } of runs) {
    const simplified = tolerance > 0 ? simplifyPath(v, tolerance) : v;
    for (const piece of splitAtAntimeridian(roundPath(simplified, decimals))) {
      if (piece.length >= 2) segments.push({ c, p, v: piece });
    }
  }
  return segments;
}
