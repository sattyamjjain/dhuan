# GEBCO Gazetteer of Undersea Feature Names

Bundled names, generic types and positions of sea floor features (trenches,
ridges, abyssal plains, fracture zones, plateaus, seamounts, canyons and more)
from the IHO-IOC GEBCO Gazetteer, read by the `seafloor-features` layer
(`src/layers/seafloor/`).

## Citation and terms

Cite as: **IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net**

The gazetteer is maintained by the GEBCO Sub-Committee on Undersea Feature
Names (SCUFN) and published free of charge by the IHO Data Centre for Digital
Bathymetry, co-located with NOAA NCEI. Terms of use are those published at
<https://www.gebco.net/data-products/undersea-feature-names>. Service copyright text: "IHO Data Centre for Digital Bathymetry (IHO DCDB); General Bathymetric Chart of the Oceans (GEBCO); NOAA National Centers for Environmental Information (NCEI)".
See [`DATA_SOURCES.md`](../../../../DATA_SOURCES.md) for the project-wide
data-licensing summary.

## Files

| File | Source | Features |
|---|---|---|
| `seafloor-features.json` | FeatureServer layers 0 (points), 1 (lines), 2 (polygons) at `https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/Undersea_Features/FeatureServer` | 2632 points, 1128 lines, 1650 polygons |

Fetched 2026-11-08T04:16:51.121Z. Regenerate with `node scripts/fetch-gebco-gazetteer.mjs`
(parameters are in the script and in `meta.curation`).

## Schema

`meta` records the source, fetch time, citation, curation parameters and
per-geometry counts. Every entry of `features[]` has:

| Key | Meaning |
|---|---|
| `n` | Specific name (NAME, whitespace collapsed), e.g. `Mariana`; the display label is name plus type, `Mariana Trench` |
| `t` | Generic type as served (TYPE), e.g. `Trench`, `Seamounts`, `Fracture Zone`; `src/layers/seafloor/classification.js` maps it to a colour family |
| `k` | `major` (outlined and named at every zoom) or `minor` (anchor only, named up close) |
| `r` | Rank, 1 = most important; types the classifier does not know rank 30 |
| `g` | Geometry: `p` point, `l` line, `y` polygon |
| `a` | Anchor `[lon, lat]`: mean of the points, the length midpoint of the longest line, or the centroid of the largest ring |
| `c` | Paths `[[lon, lat], ...][]` (lines and polygon outer rings only; omitted for points) |

## Curation

- Coordinates rounded to 3 decimals (~110 m), server-side.
- Line and ring paths simplified with Douglas-Peucker at 0.02 degrees;
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
- Size budget 921600 bytes, enforced by `src/layers/seafloor/bundle.test.mjs`.

## Types

| Type | Features |
|---|---|
| Seamount | 1537 |
| Canyon | 456 |
| Bank | 417 |
| Ridge | 400 |
| Hill | 323 |
| Basin | 277 |
| Guyot | 203 |
| Knoll | 195 |
| Fracture Zone | 157 |
| Trough | 148 |
| Seamounts | 138 |
| Valley | 104 |
| Rise | 96 |
| Hills | 94 |
| Escarpment | 74 |
| Spur | 74 |
| Reef | 72 |
| Plateau | 60 |
| Abyssal Plain | 52 |
| Trench | 39 |
| Terrace | 36 |
| Seachannel | 30 |
| Hole | 29 |
| Fan | 25 |
| Canyons | 24 |
| Deep | 24 |
| Knolls | 23 |
| Sea Channel | 22 |
| Shoal | 22 |
| Gap | 21 |
| Channel | 19 |
| Shelf | 18 |
| Seamount Chain | 16 |
| Reefs | 14 |
| Passage | 13 |
| Peak | 13 |
| Saddle | 13 |
| Guyots | 11 |
| Ridges | 11 |
| Slope | 11 |
| Caldera | 10 |
| Banks | 8 |
| Pingos | 6 |
| Levee | 5 |
| Plain | 5 |
| Tablemount | 5 |
| Seamount Province | 4 |
| Valleys | 4 |
| Borderland | 3 |
| Canyon Province | 3 |
| Mud Volcano | 3 |
| Promontory | 3 |
| Rift | 3 |
| Shoals | 3 |
| Apron | 2 |
| Ground | 2 |
| Province | 2 |
| Re-entrant | 2 |
| Scarp | 2 |
| Sill | 2 |
| Bars | 1 |
| Basin and Ridge Province | 1 |
| Calderas | 1 |
| Cap | 1 |
| Cone | 1 |
| Continental Slope | 1 |
| Deeps | 1 |
| Discordance | 1 |
| Finger | 1 |
| Fracture Zone Province | 1 |
| Fracture Zone System | 1 |
| Hill Province | 1 |
| Lobe | 1 |
| Mound | 1 |
| Mounds | 1 |
| Pass | 1 |
| Salt Dome Province | 1 |
| Sand Ridge Province | 1 |
| Sea Valley | 1 |
| Sea Valleys | 1 |
| Seabight | 1 |
| Seamount Group | 1 |
