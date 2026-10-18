import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  AIR_QUALITY_PROVIDERS,
  DEFAULT_AIR_QUALITY_PROVIDER_ID,
  normalizeAqhiStations,
  normalizeAqhiObservations,
  normalizeCpcbReadings,
} from './model.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel and the Weather card show them translated.
const msg = (text) => text;

const COLLECTIONS_ROOT = 'https://api.weather.gc.ca/collections';
const STATIONS_URL = `${COLLECTIONS_ROOT}/aqhi-stations/items`;
const OBSERVATIONS_URL = `${COLLECTIONS_ROOT}/aqhi-observations-realtime/items`;

/** Comfortably above Canada's ~134 stations without inviting a huge page. */
const STATION_LIMIT = 500;
const OBSERVATION_LIMIT = 500;
/** Station geometry is near-static — a few changes a year. Refetch twice a day. */
const STATION_TTL_MS = 12 * 60 * 60 * 1000;
/** A full 500-row GeoJSON page is a few hundred KB; anything past this is not a page. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Request and validate a complete ECCC AQHI snapshot before it can replace
 * displayed readings. The first registered air-quality provider.
 *
 * Two collections are involved. `aqhi-stations` is the catalog — it supplies
 * every reading its coordinates and is cached for twelve hours because it
 * barely changes. `aqhi-observations-realtime` is the hourly reading feed,
 * requested with `latest=true` so the response is current values rather than
 * the full observation history, which is roughly 2,000 rows nationally.
 *
 * The station catalog is only replaced when a refresh actually returns
 * stations, so a transient empty response cannot blank the layer.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {() => number} [options.now] - Clock seam, for tests.
 * @param {number} [options.timeoutMs=15000] - Deadline for each request.
 * @returns {{providerId: string, getSnapshot: Function}}
 */
export function createEcccAirQualitySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = 15_000,
} = {}) {
  /** @type {Map<string, object>} */
  let stations = new Map();
  let stationsFetchedAt = 0;

  /** One bounded GeoJSON page: deadline, caller abort, byte cap, row cap. */
  const getJson = async (url, limit, signal) => {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(msg('ECCC request timed out'))),
      timeoutMs,
    );
    try {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`ECCC HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        MAX_RESPONSE_BYTES,
        controller.signal,
      );
      // The server's `limit` is a request, not a guarantee.
      if (Array.isArray(payload?.features) && payload.features.length > limit)
        return { ...payload, features: payload.features.slice(0, limit) };
      return payload;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };

  return {
    providerId: 'eccc',
    async getSnapshot({ signal } = {}) {
      const clock = now();
      if (stations.size === 0 || clock - stationsFetchedAt > STATION_TTL_MS) {
        const payload = await getJson(
          `${STATIONS_URL}?f=json&limit=${STATION_LIMIT}`,
          STATION_LIMIT,
          signal,
        );
        const next = normalizeAqhiStations(payload);
        if (!next) throw new Error(msg('Malformed AQHI station response'));
        // An empty refresh must not wipe a good catalog.
        if (next.size > 0) {
          stations = next;
          stationsFetchedAt = clock;
        }
      }
      if (stations.size === 0)
        throw new Error(msg('No AQHI stations available'));

      const payload = await getJson(
        `${OBSERVATIONS_URL}?f=json&latest=true&limit=${OBSERVATION_LIMIT}`,
        OBSERVATION_LIMIT,
        signal,
      );
      const readings = normalizeAqhiObservations(payload, stations, clock);
      if (!readings)
        throw new Error(msg('Malformed AQHI observation response'));
      return readings;
    },
  };
}

/** The local proxy that keeps the data.gov.in key server-side. */
export const CPCB_PROXY_PATH = '/api/cpcb';
/** ~4,000 trimmed rows is well under 1 MB; anything past this is not a snapshot. */
const CPCB_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Request and validate a complete CPCB snapshot before it can replace
 * displayed readings. The second registered air-quality provider (India).
 *
 * The browser never talks to data.gov.in: the /api/cpcb proxy holds the key,
 * caches for twenty minutes and serves stale on upstream failure. Without a
 * key it answers 503 `{error:'no_key'}`, which this source reports as
 * `{keyRequired: true}` so the layer can show KEY REQUIRED rather than a
 * fault (the FIRMS source's contract).
 *
 * A refresh that normalises to zero stations keeps the last good readings:
 * the mirror occasionally publishes an empty or partial hour, and a blank
 * layer would read as "all clear".
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {() => number} [options.now] - Clock seam, for tests.
 * @param {number} [options.timeoutMs=15000] - Deadline for the request.
 * @param {string} [options.endpoint] - Proxy path, for embedding hosts.
 * @returns {{providerId: string, getSnapshot: Function}}
 */
export function createCpcbAirQualitySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = 15_000,
  endpoint = CPCB_PROXY_PATH,
} = {}) {
  /** @type {Array<object>|null} */
  let lastGood = null;

  return {
    providerId: 'cpcb',
    async getSnapshot({ signal } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error(msg('CPCB request timed out'))),
        timeoutMs,
      );
      try {
        signal?.throwIfAborted();
        const response = await fetchImpl(endpoint, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            /* status below remains authoritative */
          }
          if (response.status === 503 && payload?.error === 'no_key')
            return { keyRequired: true };
          throw new Error(`CPCB HTTP ${response.status}`);
        }
        const payload = await readResponseJsonCapped(
          response,
          CPCB_MAX_RESPONSE_BYTES,
          controller.signal,
        );
        const readings = normalizeCpcbReadings(payload, now());
        if (!readings) throw new Error(msg('Malformed CPCB response'));
        // An empty refresh must not wipe good readings.
        if (readings.length === 0 && lastGood?.length) return lastGood;
        lastGood = readings;
        return readings;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

const AIR_QUALITY_SOURCE_FACTORIES = Object.freeze({
  eccc: createEcccAirQualitySource,
  cpcb: createCpcbAirQualitySource,
});

/**
 * Normalise a configured provider id to a registered one.
 * @param {string|null|undefined} candidate
 * @returns {string}
 */
export function resolveAirQualityProviderId(candidate) {
  const id = String(candidate ?? '')
    .trim()
    .toLowerCase();
  return Object.hasOwn(AIR_QUALITY_PROVIDERS, id)
    ? id
    : DEFAULT_AIR_QUALITY_PROVIDER_ID;
}

/**
 * The air-quality source for a provider id, without starting acquisition.
 * @param {{providerId?: string}} [options] - Plus the provider factory's options.
 * @returns {{providerId: string, getSnapshot: Function}}
 */
export function createAirQualitySource({ providerId, ...options } = {}) {
  const id = resolveAirQualityProviderId(providerId);
  return AIR_QUALITY_SOURCE_FACTORIES[id](options);
}
