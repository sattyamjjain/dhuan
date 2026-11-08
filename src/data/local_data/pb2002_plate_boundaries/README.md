# PB2002 plate boundaries

Tectonic plate boundaries for the `seafloor-features` layer
(`src/layers/seafloor/`): the spreading ridges, subduction zones and
transform faults of the ocean floor, from Peter Bird's PB2002 model.

## Source and credit

- Dataset: *An updated digital model of plate boundaries*, Peter Bird,
  Geochemistry Geophysics Geosystems 4(3), 1027, 2003,
  doi:10.1029/2001GC000252.
- GeoJSON conversion: Hugo Ahlenius, Nordpil, via
  [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates)
  (`GeoJSON/PB2002_steps.json`).
- Credit: **Peter Bird (2003); Hugo Ahlenius, Nordpil**.

## Licence

The fraxen/tectonicplates collection is published under the
**Open Data Commons Attribution License (ODC-By 1.0)**,
<https://opendatacommons.org/licenses/by/1.0/>. Attribution to the sources above is required when the data
is redistributed; this bundle is a derived work (filtered, merged, rounded)
and stays under the same licence. See
[`DATA_SOURCES.md`](../../../../DATA_SOURCES.md).

## Files

| File | Source URL | Content |
|---|---|---|
| `plate-boundaries.json` | `https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json` | 1270 segments, 3734 vertices |

Fetched 2026-11-08T04:16:50.685Z; source SHA-256 `528fdeb1d57eb3d4c6e730951eabc6fd7da9dbc5fc7038b9f19100c52b986c9a`.
Regenerate with `node scripts/derive-plate-boundaries.mjs`
(`--include-continental` adds the CRB/CTF/CCB/OCB classes;
`--input <file>` reads a local copy of the source).

## Schema

`meta` records the source, fetch time, licence, credit, step counts per
class and the segment count. Every entry of `segments[]` has:

| Key | Meaning |
|---|---|
| `c` | Step class (see glossary) |
| `p` | Plate pair, e.g. `AF-AN` (PLATEBOUND) |
| `v` | Vertices `[[lon, lat], ...]`, 2 decimals |

## Step classes bundled

| Code | Meaning | Steps |
|---|---|---|
| `OSR` | Oceanic spreading ridge | 1875 steps |
| `SUB` | Subduction zone | 1129 steps |
| `OTF` | Oceanic transform fault | 1147 steps |

## Curation

- Only the classes above are kept (continental classes omitted: they run across land and the layer is about the sea floor).
- Consecutive steps of one boundary with the same class that share an
  endpoint are merged into one segment.
- Coordinates rounded to 2 decimals (~1 km; the source steps are
  1 to 10 km wide features); duplicate vertices dropped.
- Segments are split where they cross the antimeridian.
- Size budget 184320 bytes, enforced by `src/layers/seafloor/bundle.test.mjs`.
