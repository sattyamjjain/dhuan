import { resolveAirQualityProviderId } from '../layers/airQuality/source.js';

/**
 * The air-quality provider this build selects when nothing overrides it.
 *
 * This is the edition's one policy decision inside the portable reference
 * sources, kept here rather than imported from `src/edition.js` so the
 * reference-sources package stays free of application modules. Upstream's
 * value is `eccc`; `src/edition.js` re-exports this constant so the policy
 * still reads from one place.
 */
export const EDITION_AIR_QUALITY_PROVIDER_ID = 'cpcb';

/**
 * The air-quality provider this build selects.
 *
 * `VITE_AIR_QUALITY_PROVIDER` in .env wins (so an upstream checkout can try
 * CPCB and this edition can fall back to ECCC); otherwise the edition's
 * default. Unknown values resolve to the first registered provider.
 * @param {object} [env=import.meta.env]
 * @returns {string}
 */
export function selectedAirQualityProviderId(env = import.meta.env) {
  const configured = String(env?.VITE_AIR_QUALITY_PROVIDER ?? '').trim();
  return resolveAirQualityProviderId(
    configured || EDITION_AIR_QUALITY_PROVIDER_ID,
  );
}
