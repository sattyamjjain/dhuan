/**
 * @module edition
 *
 * The one place this build differs from upstream God's Eye View by policy
 * rather than by feature. Dhuan (धुआँ, "smoke") is the India smog-season
 * edition: it defaults to the CPCB air-quality network, opens over Punjab,
 * counts NASA fire detections over the stubble belt, and keeps the military
 * and camera layers out of the catalog.
 *
 * Everything here is data. Upstream behaviour is the fallback for every field,
 * so a fork that empties this file is upstream again.
 */
import { msg } from './i18n/marker.js';

export const EDITION = Object.freeze({
  id: 'dhuan',
  /** Devanagari first, Latin under it, as the wordmark reads. */
  wordmark: 'धुआँ · Dhuan',

  /**
   * The air-quality provider this build selects by default. `eccc` is
   * upstream's; `VITE_AIR_QUALITY_PROVIDER` in .env overrides either way.
   * The reference sources (a portable package that cannot import this file)
   * carry the same literal as EDITION_AIR_QUALITY_PROVIDER_ID; a test keeps
   * the two in step.
   */
  airQualityProviderId: 'cpcb',

  /**
   * Layers this edition never shows or enables: they stay registered (the
   * share-link token ledger and the control surface need the instances) but
   * are hidden from the panel, refused by the manager, and skipped by voice.
   */
  excludedLayerIds: Object.freeze([
    // No cameras in India (public CCTV and ALPR). No military or "vital
    // installation" layers (Official Secrets Act, 1923).
    'military',
    'military-awareness',
    'military-installations',
    'cctv',
    'alpr-cameras',
    // Off the story. Each stays registered and reachable upstream; this
    // edition's panel shows the fires, the air, the weather that moves the
    // smoke, the quakes and the flights the smog grounds.
    'ais-live-vessels',
    'bhote-koshi-2026',
    'bhote-koshi-locator',
    'bikeshare',
    'directions',
    'fire-perimeters',
    'gnss-integrity',
    'local-adsb',
    'local-dams',
    'local-datacenters',
    'radio',
    'rocket-launches',
    'satellites',
    'street-level',
    'telegeography-submarine-cables',
    'traffic',
    'transit',
  ]),

  /**
   * How the Layers panel groups what is left: the story first, then the
   * weather that moves the smoke, then everything else that is live.
   */
  panelGroups: Object.freeze([
    Object.freeze({
      label: msg('Smog season'),
      ids: Object.freeze(['local-firms', 'air-quality', 'wind']),
    }),
    Object.freeze({
      label: msg('Weather'),
      ids: Object.freeze([
        'weather-satellite',
        'weather-radar',
        'weather-lightning',
        'weather-cyclones',
      ]),
    }),
    Object.freeze({
      label: msg('Also live'),
      ids: Object.freeze(['earthquakes', 'flights', 'recent-imagery']),
    }),
  ]),

  /** Material Symbols glyphs for the panel rows (see index.html's subset). */
  layerGlyphs: Object.freeze({
    'local-firms': 'local_fire_department',
    'air-quality': 'masks',
    wind: 'air',
    'weather-satellite': 'cloud',
    'weather-radar': 'rainy',
    'weather-lightning': 'thunderstorm',
    'weather-cyclones': 'cyclone',
    earthquakes: 'landslide',
    flights: 'flight',
    'recent-imagery': 'satellite_alt',
  }),

  /**
   * Chrome policy. Upstream's tactical dressing (the classification HUD, the
   * circular scope mask, the sensor presets, the voice dock) is retired here:
   * a public-health story reads better as a calm briefing than a spy feed.
   * `false` means unavailable, not merely off: share links, presets and
   * scene playback cannot bring either back, and their controls are hidden.
   */
  ui: Object.freeze({
    scopeMask: false,
    tacticalHud: false,
    /**
     * Single-key shortcuts whose controls this edition hides stay off too:
     * the sensor-preset keys (1–7), the HUD key (H) and the CCTV key (C).
     */
    keyboardShortcuts: Object.freeze({
      styles: false,
      hud: false,
      cctv: false,
    }),
  }),

  /**
   * The data keys this edition's layers can use, in the order the Data keys
   * dialog lists them. Upstream's registry (src/keySetupCore.mjs) still knows
   * every provider; keys for excluded layers are simply not asked for.
   */
  keyIds: Object.freeze([
    'google-maps',
    'cesium-ion',
    'firms',
    'cpcb',
    'opensky',
  ]),

  /** The first-run dialog's one persuasive line and its primary mission. */
  firstRun: Object.freeze({
    description: msg(
      'Stubble fires in Punjab, the wind that carries the smoke, and the air Delhi breathes. Every number comes from a public feed.',
    ),
    missionLayerIds: Object.freeze(['local-firms', 'air-quality', 'wind']),
  }),

  /**
   * The story strip under the wordmark: the fire count, the city's air, and
   * the scene the Play button starts. The air region is a bounding box over
   * Delhi NCR (Gurugram to Ghaziabad, Faridabad to Sonipat's edge).
   */
  story: Object.freeze({
    sceneId: 'smog-season-live',
    fireRegionId: 'punjab-haryana',
    airRegion: Object.freeze({
      id: 'delhi-ncr',
      label: msg('Delhi NCR'),
      bbox: Object.freeze({
        west: 76.75,
        south: 28.25,
        east: 77.65,
        north: 28.95,
      }),
    }),
  }),

  /**
   * The startup view when no share link restores one: Punjab's stubble belt
   * at dusk, looking south-east down the wind toward Delhi.
   */
  home: Object.freeze({
    label: msg('Flying to Punjab, India...'),
    /** High, straight down, before the cinematic settle. */
    approach: Object.freeze({
      lat: 30.6,
      lon: 75.6,
      alt: 2_400_000,
      heading: 0,
      pitch: -90,
    }),
    /** Where the fly-in ends. Ellipsoid metres; Cesium heading/pitch degrees. */
    rest: Object.freeze({
      lat: 30.45,
      lon: 75.55,
      alt: 380_000,
      heading: 135,
      pitch: -58,
    }),
  }),

  /**
   * Regions the fire layer counts detections in. A bounding box, not a
   * boundary: the Punjab + Haryana box clips slivers of Rajasthan, Himachal,
   * Uttar Pradesh and Delhi, and the label says "box" for that reason.
   */
  fireRegions: Object.freeze([
    Object.freeze({
      id: 'punjab-haryana',
      label: msg('Punjab + Haryana (bounding box)'),
      shortLabel: 'PUNJAB+HARYANA',
      bbox: Object.freeze({ west: 73.8, south: 27.6, east: 77.6, north: 32.6 }),
    }),
  ]),

  /** The one region the HUD summary line carries. */
  hudFireRegionId: 'punjab-haryana',

  /** The caveat that travels with every fire count. */
  fireCountCaveat: msg(
    'Polar passes before 1:30 PM miss most after-3 PM fires, so this count is a floor.',
  ),
});

/** Is a layer id excluded from this edition? */
export function isExcludedLayerId(layerId) {
  return EDITION.excludedLayerIds.includes(String(layerId ?? ''));
}
