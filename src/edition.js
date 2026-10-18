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
import { EDITION_AIR_QUALITY_PROVIDER_ID } from './sources/airQualityProvider.js';

export const EDITION = Object.freeze({
  id: 'dhuan',
  /** Devanagari first, Latin under it, as the wordmark reads. */
  wordmark: 'धुआँ · Dhuan',

  /**
   * The air-quality provider this build selects by default. `eccc` is
   * upstream's; `VITE_AIR_QUALITY_PROVIDER` in .env overrides either way.
   * The constant lives with the reference sources (a portable package) and
   * is mirrored here so the policy still reads from one place.
   */
  airQualityProviderId: EDITION_AIR_QUALITY_PROVIDER_ID,

  /**
   * Layers this edition never shows or enables: they stay registered (the
   * share-link token ledger and the control surface need the instances) but
   * are hidden from the panel, refused by the manager, and skipped by voice.
   *
   * No cameras in India (public CCTV and ALPR). No military or "vital
   * installation" layers (Official Secrets Act, 1923).
   */
  excludedLayerIds: Object.freeze([
    'military',
    'military-awareness',
    'military-installations',
    'cctv',
    'alpr-cameras',
  ]),

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
