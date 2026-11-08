#!/usr/bin/env node
/**
 * Fetch the IHO-IOC GEBCO Gazetteer of Undersea Feature Names from NOAA's
 * hosted FeatureServer and write the compact bundle the sea floor layer
 * reads, plus its README and source.json.
 *
 *   node scripts/fetch-gebco-gazetteer.mjs
 *
 * Three layers (points, lines, polygons) are paged 2,000 records at a time
 * with geometryPrecision=3 (server-side rounding). Paths are simplified with
 * Douglas-Peucker at 0.02 degrees, polygons keep outer rings only, every path
 * is split at the antimeridian, and each feature gets one anchor for its
 * marker and label. Output keys are short because the bundle ships to the
 * browser: n name, t type, k kind, r rank, g geometry (p|l|y), a anchor
 * [lon,lat], c paths.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNKNOWN_TYPE_RANK,
  classifyFeatureType,
} from '../src/layers/seafloor/classification.js';
import {
  roundPath,
  simplifyPath,
  simplifyRing,
  splitAtAntimeridian,
} from '../src/layers/seafloor/plates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/data/local_data/gebco_gazetteer');
const SERVICE =
  'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/Undersea_Features/FeatureServer';
const LAYERS = Object.freeze([
  { id: 0, g: 'p', name: 'Point_Features', key: 'point' },
  { id: 1, g: 'l', name: 'Line_Features', key: 'line' },
  { id: 2, g: 'y', name: 'Polygon_Features', key: 'polygon' },
]);
const PAGE_SIZE = 2000;
const COORD_DECIMALS = 3;
const SIMPLIFY_TOLERANCE_DEG = 0.02;
const BUDGET_BYTES = 900 * 1024;
const CITATION =
  'IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net';
const SOURCE_NAME = 'IHO-IOC GEBCO Gazetteer of Undersea Feature Names';
const TERMS_URL = 'https://www.gebco.net/data-products/undersea-feature-names';
const COPYRIGHT =
  'IHO Data Centre for Digital Bathymetry (IHO DCDB); General Bathymetric Chart of the Oceans (GEBCO); NOAA National Centers for Environmental Information (NCEI)';

async function fetchJson(url, { timeoutMs = 60_000, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const json = await response.json();
      if (json?.error) throw new Error(`${url}: ${JSON.stringify(json.error)}`);
      return json;
    } catch (error) {
      lastError = error;
      console.warn(`attempt ${attempt} failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function queryUrl(layer, oidField, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'NAME,TYPE',
    outSR: '4326',
    geometryPrecision: String(COORD_DECIMALS),
    orderByFields: `${oidField} ASC`,
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
    f: 'geojson',
  });
  return `${SERVICE}/${layer.id}/query?${params}`;
}

/** Page one layer until a short page or the server stops reporting overflow. */
async function fetchLayer(layer) {
  const info = await fetchJson(`${SERVICE}/${layer.id}?f=json`);
  const oidField = info.objectIdField || 'OBJECTID';
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchJson(queryUrl(layer, oidField, offset));
    const batch = Array.isArray(page.features) ? page.features : [];
    features.push(...batch);
    console.log(`${layer.name}: ${features.length} so far`);
    const more = page.properties?.exceededTransferLimit === true;
    if (batch.length < PAGE_SIZE || !more) break;
  }
  return features;
}

/** Mean of a point cloud, unwrapped so a cloud straddling 180 averages correctly. */
function meanLonLat(points) {
  const lons = points.map((p) => p[0]);
  const wrap = Math.max(...lons) - Math.min(...lons) > 180;
  let lonSum = 0;
  let latSum = 0;
  for (const [lon, lat] of points) {
    lonSum += wrap && lon < 0 ? lon + 360 : lon;
    latSum += lat;
  }
  let lon = lonSum / points.length;
  if (lon > 180) lon -= 360;
  return [lon, latSum / points.length];
}

function pathLengthDeg(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const midLat = ((path[i][1] + path[i - 1][1]) / 2) * (Math.PI / 180);
    total += Math.hypot(
      (path[i][0] - path[i - 1][0]) * Math.cos(midLat),
      path[i][1] - path[i - 1][1],
    );
  }
  return total;
}

/** The vertex nearest the length midpoint of the longest path. */
function midpointVertex(paths) {
  const longest = paths.reduce((best, p) =>
    pathLengthDeg(p) > pathLengthDeg(best) ? p : best,
  );
  const half = pathLengthDeg(longest) / 2;
  let walked = 0;
  for (let i = 1; i < longest.length; i++) {
    const step = pathLengthDeg([longest[i - 1], longest[i]]);
    if (walked + step >= half) {
      return walked + step - half < half - walked ? longest[i] : longest[i - 1];
    }
    walked += step;
  }
  return longest[longest.length - 1];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

/** Shoelace centroid of the largest ring; falls back to the vertex mean. */
function ringCentroid(rings) {
  const ring = rings.reduce((best, r) =>
    Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best,
  );
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-9) return meanLonLat(ring);
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function roundAnchor([lon, lat]) {
  const factor = 10 ** COORD_DECIMALS;
  return [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor];
}

function pointParts(geometry) {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'MultiPoint') return geometry.coordinates;
  return [];
}

function lineParts(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function outerRings(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

/**
 * Simplify a ring, falling back to finer tolerances when the ring collapses.
 * Reef and knoll outlines are often smaller than the 0.02 degree tolerance;
 * dropping them would lose the feature, not just its outline.
 */
function simplifyRingKeeping(ring) {
  for (const tolerance of [
    SIMPLIFY_TOLERANCE_DEG,
    SIMPLIFY_TOLERANCE_DEG / 10,
    0,
  ]) {
    const simplified = simplifyRing(ring, tolerance);
    if (simplified.length) return simplified;
  }
  return [];
}

/** Geometry -> { a, c } for the bundle, or null when nothing usable remains. */
function convertGeometry(geometry, g) {
  if (!geometry) return null;
  if (g === 'p') {
    const points = pointParts(geometry).filter(
      (p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]),
    );
    return points.length ? { a: roundAnchor(meanLonLat(points)) } : null;
  }
  const paths = (g === 'l' ? lineParts(geometry) : outerRings(geometry))
    .map((part) =>
      g === 'l'
        ? simplifyPath(part, SIMPLIFY_TOLERANCE_DEG)
        : simplifyRingKeeping(part),
    )
    .map((part) => roundPath(part, COORD_DECIMALS))
    .filter((part) => part.length >= 2);
  if (!paths.length) return null;
  const anchor = g === 'l' ? midpointVertex(paths) : ringCentroid(paths);
  return {
    a: roundAnchor(anchor),
    c: paths.flatMap((part) => splitAtAntimeridian(part)),
  };
}

/**
 * The gazetteer's NAME is the specific part only ("Mariana", "Mid-Atlantic");
 * the generic TYPE completes it ("Mariana Trench"). The bundle therefore keeps
 * TYPE as served (plural and all) for display, and stores the classification
 * (kind, rank) beside it; the layer derives the colour family from the type.
 */
function convertFeature(feature, g) {
  const clean = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const name = clean(feature?.properties?.NAME);
  const type = clean(feature?.properties?.TYPE);
  if (!name || !type || type.toUpperCase() === 'UNKNOWN') return null;
  const converted = convertGeometry(feature.geometry, g);
  if (!converted) return null;
  const { kind, rank } = classifyFeatureType(type);
  return { n: name, t: type, k: kind, r: rank, g, ...converted };
}

function compareFeatures(a, b) {
  return (
    a.r - b.r || a.n.localeCompare(b.n, 'en') || a.g.localeCompare(b.g, 'en')
  );
}

function serialize(pack) {
  const lines = pack.features.map((feature) => JSON.stringify(feature));
  return `{"meta":${JSON.stringify(pack.meta)},\n"features":[\n${lines.join(',\n')}\n]}\n`;
}

function readmeText(meta, typeCounts) {
  const typeRows = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join('\n');
  return `# GEBCO Gazetteer of Undersea Feature Names

Bundled names, generic types and positions of sea floor features (trenches,
ridges, abyssal plains, fracture zones, plateaus, seamounts, canyons and more)
from the IHO-IOC GEBCO Gazetteer, read by the \`seafloor-features\` layer
(\`src/layers/seafloor/\`).

## Citation and terms

Cite as: **${CITATION}**

The gazetteer is maintained by the GEBCO Sub-Committee on Undersea Feature
Names (SCUFN) and published free of charge by the IHO Data Centre for Digital
Bathymetry, co-located with NOAA NCEI. Terms of use are those published at
<${TERMS_URL}>. Service copyright text: "${COPYRIGHT}".
See [\`DATA_SOURCES.md\`](../../../../DATA_SOURCES.md) for the project-wide
data-licensing summary.

## Files

| File | Source | Features |
|---|---|---|
| \`seafloor-features.json\` | FeatureServer layers 0 (points), 1 (lines), 2 (polygons) at \`${SERVICE}\` | ${meta.counts.point} points, ${meta.counts.line} lines, ${meta.counts.polygon} polygons |

Fetched ${meta.fetched}. Regenerate with \`node scripts/fetch-gebco-gazetteer.mjs\`
(parameters are in the script and in \`meta.curation\`).

## Schema

\`meta\` records the source, fetch time, citation, curation parameters and
per-geometry counts. Every entry of \`features[]\` has:

| Key | Meaning |
|---|---|
| \`n\` | Specific name (NAME, whitespace collapsed), e.g. \`Mariana\`; the display label is name plus type, \`Mariana Trench\` |
| \`t\` | Generic type as served (TYPE), e.g. \`Trench\`, \`Seamounts\`, \`Fracture Zone\`; \`src/layers/seafloor/classification.js\` maps it to a colour family |
| \`k\` | \`major\` (outlined and named at every zoom) or \`minor\` (anchor only, named up close) |
| \`r\` | Rank, 1 = most important; types the classifier does not know rank ${UNKNOWN_TYPE_RANK} |
| \`g\` | Geometry: \`p\` point, \`l\` line, \`y\` polygon |
| \`a\` | Anchor \`[lon, lat]\`: mean of the points, the length midpoint of the longest line, or the centroid of the largest ring |
| \`c\` | Paths \`[[lon, lat], ...][]\` (lines and polygon outer rings only; omitted for points) |

## Curation

- Coordinates rounded to ${COORD_DECIMALS} decimals (~110 m), server-side.
- Line and ring paths simplified with Douglas-Peucker at ${SIMPLIFY_TOLERANCE_DEG} degrees;
  a ring that collapses retries at a tenth of that, then unsimplified, so
  small reefs and knolls keep their outline.
- Polygons keep outer rings only (the layer draws outlines, never fills).
- Every path is split where it crosses the antimeridian.
- Features without a name or usable geometry, and the one feature typed
  UNKNOWN, are dropped; OBJECTID and FEATURE_ID are not bundled.
- A feature published in more than one geometry layer (a seamount with both
  a summit point and an outline) is kept in each; same-name points are often
  distinct features in different oceans, so nothing is deduplicated.
- Sorted by rank, then name, for a stable diff.
- Size budget ${BUDGET_BYTES} bytes, enforced by \`src/layers/seafloor/bundle.test.mjs\`.

## Types

| Type | Features |
|---|---|
${typeRows}
`;
}

async function main() {
  const fetched = new Date().toISOString();
  const features = [];
  const counts = {};
  for (const layer of LAYERS) {
    const raw = await fetchLayer(layer);
    const converted = raw
      .map((feature) => convertFeature(feature, layer.g))
      .filter(Boolean);
    counts[layer.key] = converted.length;
    console.log(
      `${layer.name}: ${raw.length} fetched, ${converted.length} kept`,
    );
    features.push(...converted);
  }
  features.sort(compareFeatures);
  const meta = {
    source: SOURCE_NAME,
    url: SERVICE,
    fetched,
    citation: CITATION,
    license: `Free to use with citation; terms at ${TERMS_URL}`,
    copyright: COPYRIGHT,
    curation: {
      coordDecimals: COORD_DECIMALS,
      simplifyToleranceDeg: SIMPLIFY_TOLERANCE_DEG,
      outerRingsOnly: true,
      antimeridianSplit: true,
    },
    counts,
  };
  const text = serialize({ meta, features });
  await mkdir(OUT_DIR, { recursive: true });
  const dataPath = path.join(OUT_DIR, 'seafloor-features.json');
  await writeFile(dataPath, text);
  const bytes = Buffer.byteLength(text);
  const sha256 = createHash('sha256').update(text).digest('hex');
  const typeCounts = new Map();
  for (const feature of features)
    typeCounts.set(feature.t, (typeCounts.get(feature.t) || 0) + 1);
  await writeFile(
    path.join(OUT_DIR, 'README.md'),
    readmeText(meta, typeCounts),
  );
  await writeFile(
    path.join(OUT_DIR, 'source.json'),
    JSON.stringify(
      {
        id: 'gebco-gazetteer',
        name: SOURCE_NAME,
        category: 'reference',
        description:
          'Names, generic types and positions of undersea features from the GEBCO Gazetteer, fetched from the NOAA NCEI hosted FeatureServer and reduced to anchors plus simplified outlines.',
        downloaded_at: fetched.slice(0, 10),
        license_note: `Cite as "${CITATION}". Published free of charge by IHO DCDB / NOAA NCEI; terms at ${TERMS_URL}.`,
        files: [
          {
            path: 'seafloor-features.json',
            url: SERVICE,
            layer_urls: LAYERS.map((layer) => `${SERVICE}/${layer.id}/query`),
            format: 'JSON (custom compact schema, see README.md)',
            feature_count: features.length,
            sha256,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `${path.relative(ROOT, dataPath)}: ${features.length} features, ${bytes} bytes (budget ${BUDGET_BYTES})`,
  );
  if (bytes > BUDGET_BYTES) {
    console.error('Bundle exceeds its size budget');
    process.exitCode = 1;
  }
}

await main();
