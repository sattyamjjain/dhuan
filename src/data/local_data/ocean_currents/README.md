# Ocean currents (schematic)

Hand-drawn GeoJSON of the thirty major ocean surface currents, used by the
`ocean-currents` layer (`src/layers/oceanCurrents/`). It is a textbook
schematic, not a measurement: the lines follow the shapes found on standard
classroom and atlas maps of the surface circulation, redrawn from memory of
those shapes onto a globe grid. No NOAA, Maps.com or other copyrighted layer
was traced, imported or sampled, and nothing here derives from a model or
observation dataset.

## License

The author dedicates these coordinates to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No attribution
is required. Positions are approximate and must not be used for navigation.

## Files

| File | Purpose |
|---|---|
| `currents.json` | GeoJSON FeatureCollection, 32 `LineString` features (30 currents; the Antarctic Circumpolar Current is split into three sector features). Top-level `meta` carries the title, licence and authoring date. |
| `source.json` | Provenance record in the same shape as the other bundled datasets, with the file's SHA-256. |

## Authoring rules

- One `LineString` per current. Vertex order is the direction of flow.
- 5 to 12 vertices per current, placed every 3 to 15 degrees, at least 4 so a
  line can bend.
- `properties`: `id` (`/^[a-z0-9-]+$/`, unique), `name` (shown verbatim),
  `temp` (`warm` or `cold`), `basin` (`atlantic`, `pacific`, `indian`,
  `southern`), `speedClass` (`fast`, `moderate`, `slow`; dash speed only) and
  `rank` (1 or 2; label priority).
- Longitudes lie in [-180, 360). A Pacific current that crosses 180 degrees is
  written with continuous longitudes past 180 (170, 190, 210 ...) so no segment
  jumps across the antimeridian. Consecutive longitudes differ by less than 180.
- The Somali Current is drawn in its summer (south-west monsoon) direction,
  flowing north-east along the Horn of Africa. It reverses during the north-east
  monsoon; the schematic does not show that.
- The Antarctic Circumpolar Current is three features that share one name so
  that each sector can be culled on its own.

`src/layers/oceanCurrents/model.test.mjs` validates the file and pins the
totals below, so this table and the data cannot drift apart.

## The thirty currents

| # | Current | Temp | Basin |
|---|---|---|---|
| 1 | Gulf Stream | warm | Atlantic |
| 2 | North Atlantic Drift | warm | Atlantic |
| 3 | Norwegian Current | warm | Atlantic |
| 4 | Canary Current | cold | Atlantic |
| 5 | North Equatorial Current (Atlantic) | warm | Atlantic |
| 6 | Caribbean Current | warm | Atlantic |
| 7 | Equatorial Counter Current (Atlantic) | warm | Atlantic |
| 8 | Guinea Current | warm | Atlantic |
| 9 | South Equatorial Current (Atlantic) | warm | Atlantic |
| 10 | Brazil Current | warm | Atlantic |
| 11 | Falkland (Malvinas) Current | cold | Atlantic |
| 12 | Benguela Current | cold | Atlantic |
| 13 | Labrador Current | cold | Atlantic |
| 14 | East Greenland Current | cold | Atlantic |
| 15 | Kuroshio | warm | Pacific |
| 16 | North Pacific Current | warm | Pacific |
| 17 | Alaska Current | warm | Pacific |
| 18 | California Current | cold | Pacific |
| 19 | North Equatorial Current (Pacific) | warm | Pacific |
| 20 | Equatorial Counter Current (Pacific) | warm | Pacific |
| 21 | South Equatorial Current (Pacific) | warm | Pacific |
| 22 | Oyashio | cold | Pacific |
| 23 | Peru (Humboldt) Current | cold | Pacific |
| 24 | East Australian Current | warm | Pacific |
| 25 | Agulhas Current | warm | Indian |
| 26 | Mozambique Current | warm | Indian |
| 27 | Somali Current | warm | Indian |
| 28 | South Equatorial Current (Indian) | warm | Indian |
| 29 | West Australian Current | cold | Indian |
| 30 | Antarctic Circumpolar Current (three sectors) | cold | Southern |

Totals: 20 warm features and 12 cold features (10 cold currents; the Antarctic
Circumpolar Current counts three times).
