#!/usr/bin/env node
/**
 * Derive the plate-boundary bundle for the sea floor layer from PB2002
 * (Bird 2003) as republished in GeoJSON by fraxen/tectonicplates.
 *
 *   node scripts/derive-plate-boundaries.mjs [--input <PB2002_steps.json>] [--include-continental]
 *
 * Keeps the oceanic step classes (OSR spreading ridge, SUB subduction zone,
 * OTF transform fault) by default, merges consecutive same-class steps of a
 * boundary into one segment, rounds to 2 decimals and splits at the
 * antimeridian. Writes plate-boundaries.json, README.md and source.json.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATE_CONTINENTAL_CLASSES,
  PLATE_OCEANIC_CLASSES,
  mergePlateSteps,
} from '../src/layers/seafloor/plates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/data/local_data/pb2002_plate_boundaries');
const SOURCE_URL =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json';
const LICENSE = 'ODC-By 1.0';
const LICENSE_URL = 'https://opendatacommons.org/licenses/by/1.0/';
const CREDIT = 'Peter Bird (2003); Hugo Ahlenius, Nordpil';
const DECIMALS = 2;
const BUDGET_BYTES = 180 * 1024;

const CLASS_GLOSSARY = Object.freeze({
  OSR: 'Oceanic spreading ridge',
  SUB: 'Subduction zone',
  OTF: 'Oceanic transform fault',
  CRB: 'Continental rift boundary',
  CTF: 'Continental transform fault',
  CCB: 'Continental convergent boundary',
  OCB: 'Oceanic convergent boundary',
});

const args = process.argv.slice(2);
const inputPath = args.includes('--input')
  ? path.resolve(args[args.indexOf('--input') + 1])
  : null;
const includeContinental = args.includes('--include-continental');

async function readSource() {
  if (inputPath) return readFile(inputPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(SOURCE_URL, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`HTTP ${response.status} for ${SOURCE_URL}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function serialize(pack) {
  const lines = pack.segments.map((segment) => JSON.stringify(segment));
  return `{"meta":${JSON.stringify(pack.meta)},\n"segments":[\n${lines.join(',\n')}\n]}\n`;
}

function readmeText(meta, classes) {
  const glossary = classes
    .map(
      (code) =>
        `| \`${code}\` | ${CLASS_GLOSSARY[code]} | ${meta.classes[code] ?? 0} steps |`,
    )
    .join('\n');
  return `# PB2002 plate boundaries

Tectonic plate boundaries for the \`seafloor-features\` layer
(\`src/layers/seafloor/\`): the spreading ridges, subduction zones and
transform faults of the ocean floor, from Peter Bird's PB2002 model.

## Source and credit

- Dataset: *An updated digital model of plate boundaries*, Peter Bird,
  Geochemistry Geophysics Geosystems 4(3), 1027, 2003,
  doi:10.1029/2001GC000252.
- GeoJSON conversion: Hugo Ahlenius, Nordpil, via
  [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates)
  (\`GeoJSON/PB2002_steps.json\`).
- Credit: **${CREDIT}**.

## Licence

The fraxen/tectonicplates collection is published under the
**Open Data Commons Attribution License (${LICENSE})**,
<${LICENSE_URL}>. Attribution to the sources above is required when the data
is redistributed; this bundle is a derived work (filtered, merged, rounded)
and stays under the same licence. See
[\`DATA_SOURCES.md\`](../../../../DATA_SOURCES.md).

## Files

| File | Source URL | Content |
|---|---|---|
| \`plate-boundaries.json\` | \`${SOURCE_URL}\` | ${meta.segments} segments, ${meta.vertices} vertices |

Fetched ${meta.fetched}; source SHA-256 \`${meta.sourceSha256}\`.
Regenerate with \`node scripts/derive-plate-boundaries.mjs\`
(\`--include-continental\` adds the CRB/CTF/CCB/OCB classes;
\`--input <file>\` reads a local copy of the source).

## Schema

\`meta\` records the source, fetch time, licence, credit, step counts per
class and the segment count. Every entry of \`segments[]\` has:

| Key | Meaning |
|---|---|
| \`c\` | Step class (see glossary) |
| \`p\` | Plate pair, e.g. \`AF-AN\` (PLATEBOUND) |
| \`v\` | Vertices \`[[lon, lat], ...]\`, ${DECIMALS} decimals |

## Step classes bundled

| Code | Meaning | Steps |
|---|---|---|
${glossary}

## Curation

- Only the classes above are kept${includeContinental ? '' : ' (continental classes omitted: they run across land and the layer is about the sea floor)'}.
- Consecutive steps of one boundary with the same class that share an
  endpoint are merged into one segment.
- Coordinates rounded to ${DECIMALS} decimals (~1 km; the source steps are
  1 to 10 km wide features); duplicate vertices dropped.
- Segments are split where they cross the antimeridian.
- Size budget ${BUDGET_BYTES} bytes, enforced by \`src/layers/seafloor/bundle.test.mjs\`.
`;
}

async function main() {
  const fetched = new Date().toISOString();
  const bytes = await readSource();
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const geojson = JSON.parse(bytes.toString('utf8'));
  const steps = Array.isArray(geojson?.features) ? geojson.features : [];
  const classes = includeContinental
    ? [...PLATE_OCEANIC_CLASSES, ...PLATE_CONTINENTAL_CLASSES]
    : [...PLATE_OCEANIC_CLASSES];
  const classCounts = {};
  for (const code of classes) classCounts[code] = 0;
  for (const step of steps) {
    const code = step?.properties?.STEPCLASS;
    if (code in classCounts) classCounts[code]++;
  }
  const segments = mergePlateSteps(steps, { classes, decimals: DECIMALS });
  const vertices = segments.reduce((sum, segment) => sum + segment.v.length, 0);
  const meta = {
    source: 'PB2002 (Bird 2003) via fraxen/tectonicplates',
    url: SOURCE_URL,
    fetched,
    sourceSha256,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    credit: CREDIT,
    curation: { decimals: DECIMALS, classes, antimeridianSplit: true },
    classes: classCounts,
    segments: segments.length,
    vertices,
  };
  const text = serialize({ meta, segments });
  await mkdir(OUT_DIR, { recursive: true });
  const dataPath = path.join(OUT_DIR, 'plate-boundaries.json');
  await writeFile(dataPath, text);
  const size = Buffer.byteLength(text);
  const sha256 = createHash('sha256').update(text).digest('hex');
  await writeFile(path.join(OUT_DIR, 'README.md'), readmeText(meta, classes));
  await writeFile(
    path.join(OUT_DIR, 'source.json'),
    JSON.stringify(
      {
        id: 'pb2002-plate-boundaries',
        name: 'PB2002 plate boundaries (Bird 2003) via fraxen/tectonicplates',
        category: 'reference',
        description:
          'Oceanic plate boundary steps from the PB2002 model, merged into segments per boundary and class.',
        downloaded_at: fetched.slice(0, 10),
        license_note: `${LICENSE} (${LICENSE_URL}). Credit ${CREDIT}.`,
        source_sha256: sourceSha256,
        files: [
          {
            path: 'plate-boundaries.json',
            url: SOURCE_URL,
            format: 'JSON (custom compact schema, see README.md)',
            feature_count: segments.length,
            sha256,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `${path.relative(ROOT, dataPath)}: ${segments.length} segments, ${vertices} vertices, ${size} bytes (budget ${BUDGET_BYTES})`,
  );
  if (size > BUDGET_BYTES) {
    console.error('Bundle exceeds its size budget');
    process.exitCode = 1;
  }
}

await main();
