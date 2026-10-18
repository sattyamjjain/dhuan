/**
 * @module layers/airQuality/model
 *
 * Air-quality readings, normalized across networks. Pure — no Cesium, no
 * network.
 *
 * Air-quality indices are not interchangeable numbers. Canada's AQHI runs 1 to
 * 10+ on health risk; India's National AQI runs 0 to 500 on concentration
 * breakpoints; Europe's EAQI is a five-step category. A reading is therefore
 * carried as `{ provider, scale, value, band }` — who measured it, which index
 * it is, the value on that index's own terms, and the band it falls in — so a
 * second network can be added without retrofitting a shared numeric meaning
 * that does not exist.
 *
 * Two providers are implemented: ECCC's AQHI (Canada) and CPCB's National AQI
 * (India, via data.gov.in). Each owns its band scale: the ids, labels, colours
 * and thresholds are the network's own, and every lookup is provider-scoped
 * so the two scales never share a band by accident.
 */
// A portable export (package.json): no i18n here. The labels stay English data;
// the Weather card (index.js) shows them translated.
const msg = (text) => text;

/** ECCC AQHI band descriptors, in ascending severity. */
export const AIR_QUALITY_BANDS = Object.freeze([
  Object.freeze({
    id: 'low',
    label: msg('Low'),
    risk: msg('Low health risk'),
    color: '#4cc9f0',
  }),
  Object.freeze({
    id: 'moderate',
    label: msg('Moderate'),
    risk: msg('Moderate health risk'),
    color: '#ffd43b',
  }),
  Object.freeze({
    id: 'high',
    label: msg('High'),
    risk: msg('High health risk'),
    color: '#ff6b35',
  }),
  Object.freeze({
    id: 'very-high',
    label: msg('Very High'),
    risk: msg('Very High health risk'),
    color: '#c1121f',
  }),
]);

/**
 * India's National Air Quality Index (CPCB, 2014): six bands on a 0–500
 * scale. Labels and health descriptors are CPCB's published ones; colours are
 * CPCB's bulletin palette, used unchanged so the brand and the data agree.
 */
export const NAQI_BANDS = Object.freeze([
  Object.freeze({
    id: 'good',
    label: msg('Good'),
    risk: msg('Minimal impact'),
    color: '#00b050',
  }),
  Object.freeze({
    id: 'satisfactory',
    label: msg('Satisfactory'),
    risk: msg('Minor breathing discomfort to sensitive people'),
    color: '#92d050',
  }),
  Object.freeze({
    id: 'moderate',
    label: msg('Moderate'),
    risk: msg('Breathing discomfort to people with lung or heart disease'),
    color: '#ffff00',
  }),
  Object.freeze({
    id: 'poor',
    label: msg('Poor'),
    risk: msg('Breathing discomfort to most people on prolonged exposure'),
    color: '#ff9900',
  }),
  Object.freeze({
    id: 'very-poor',
    label: msg('Very Poor'),
    risk: msg('Respiratory illness on prolonged exposure'),
    color: '#ff0000',
  }),
  Object.freeze({
    id: 'severe',
    label: msg('Severe'),
    risk: msg(
      'Affects healthy people and seriously impacts those with existing disease',
    ),
    color: '#c00000',
    /**
     * CPCB's maroon sits at about 3:1 on the dark map plate and falls below
     * it over terrain through the station fill's alpha, so the on-map
     * colour (circle, overlay bar and leader) is a lighter dark red. The
     * legend swatch keeps the bulletin colour.
     */
    mapColor: '#e0201c',
  }),
]);

/** Colour used when a station reports no usable reading. */
export const AIR_QUALITY_UNKNOWN_COLOR = '#6b7785';

export const AIR_QUALITY_OVERLAY_SOURCE_ID = 'air-quality';
export const AIR_QUALITY_OVERLAY_COHORT_LIMIT = 48;
export const AIR_QUALITY_OVERLAY_COLLISION_CAPACITY = 32;

/**
 * A reading this old is stale enough that displaying it would misinform.
 * AQHI publishes hourly, so six hours is five missed publications.
 */
export const OBSERVATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How old the newest observation may be before the layer reports itself stale.
 *
 * This is deliberately separate from the age at which a reading is dropped.
 * `lastUpdate` records when we last *received* a response, which stays current
 * even when the network publishes nothing new; freshness has to be judged on
 * the source's own observation time instead. AQHI publishes hourly, so a newest
 * reading beyond two hours means at least one publication was missed and the
 * feed should not be described as live.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * CPCB publishes hourly but the data.gov.in mirror lags it by up to an hour
 * or two on a normal day, so three hours (not two) is the honest stale line.
 */
export const CPCB_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** IST has no daylight saving: CPCB timestamps are a fixed +05:30. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The newest observation time across a set of readings, or null when empty.
 * @param {Array<object>} readings
 * @returns {number|null} Epoch ms.
 */
export function newestObservation(readings) {
  if (!Array.isArray(readings) || readings.length === 0) return null;
  let newest = null;
  for (const reading of readings) {
    const at = Number(reading?.observedMs);
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/**
 * Is a set of readings stale, judged on source observation time? An empty
 * set is stale: a refresh that kept no current observation has nothing live.
 * @param {Array<object>} readings
 * @param {number} [now=Date.now()]
 * @param {number} [staleAfterMs=STALE_AFTER_MS] - The provider's stale line.
 * @returns {boolean}
 */
export function readingsAreStale(
  readings,
  now = Date.now(),
  staleAfterMs = STALE_AFTER_MS,
) {
  const newest = newestObservation(readings);
  // No current observation at all — every row was dropped as too old or
  // unusable — is the stalest a feed can be, not a nominal one.
  if (newest === null) return true;
  return now - newest > staleAfterMs;
}

/**
 * Registered provider descriptors. `coverage` is stated plainly because the
 * layer is not global and the row must say so. `bands` are the provider's
 * published thresholds, evaluated in order; `bandScale` the descriptors
 * (label, risk, colour) those ids resolve against.
 */
export const AIR_QUALITY_PROVIDERS = Object.freeze({
  eccc: Object.freeze({
    id: 'eccc',
    scale: 'AQHI',
    label: msg('Air quality'),
    network: 'Environment and Climate Change Canada',
    sourceLabel: 'ECCC MSC GeoMet',
    coverage: msg('Canada only · ECCC AQHI network'),
    requiresKeyId: null,
    staleAfterMs: STALE_AFTER_MS,
    maxObservationAgeMs: OBSERVATION_MAX_AGE_MS,
    bandScale: AIR_QUALITY_BANDS,
    /** ECCC's published band thresholds, evaluated in order. */
    bands: Object.freeze([
      Object.freeze({ id: 'low', max: 3 }),
      Object.freeze({ id: 'moderate', max: 6 }),
      Object.freeze({ id: 'high', max: 10 }),
      Object.freeze({ id: 'very-high', max: Infinity }),
    ]),
  }),
  cpcb: Object.freeze({
    id: 'cpcb',
    scale: 'AQI',
    label: msg('Air quality'),
    network: 'Central Pollution Control Board via data.gov.in',
    sourceLabel: 'CPCB · data.gov.in',
    coverage: msg('India · CPCB CAAQMS network'),
    /** The data.gov.in key the proxy needs; see keySetupCore. */
    requiresKeyId: 'cpcb',
    /** NAQI bands are numeric ranges people know; the legend says them. */
    legendRanges: true,
    /**
     * Delhi's stations sit three to five kilometres apart, so ECCC's 6 km
     * marker turns the city into one blob; a smaller point keeps them apart.
     */
    markerRadiusM: 2_500,
    staleAfterMs: CPCB_STALE_AFTER_MS,
    maxObservationAgeMs: OBSERVATION_MAX_AGE_MS,
    bandScale: NAQI_BANDS,
    /** CPCB's published NAQI breakpoints, evaluated in order. */
    bands: Object.freeze([
      Object.freeze({ id: 'good', max: 50 }),
      Object.freeze({ id: 'satisfactory', max: 100 }),
      Object.freeze({ id: 'moderate', max: 200 }),
      Object.freeze({ id: 'poor', max: 300 }),
      Object.freeze({ id: 'very-poor', max: 400 }),
      Object.freeze({ id: 'severe', max: Infinity }),
    ]),
  }),
});

export const DEFAULT_AIR_QUALITY_PROVIDER_ID = 'eccc';

/** The provider descriptor for an id, falling back to the first provider. */
export function airQualityProvider(providerId) {
  return (
    AIR_QUALITY_PROVIDERS[String(providerId ?? '')] ||
    AIR_QUALITY_PROVIDERS[DEFAULT_AIR_QUALITY_PROVIDER_ID]
  );
}

/**
 * A provider's band descriptors with thresholds merged in, ascending.
 * @param {string} providerId
 * @returns {Array<{id: string, label: string, risk: string, color: string, max: number}>}
 */
export function providerBands(providerId) {
  const provider = airQualityProvider(providerId);
  const byId = new Map(provider.bandScale.map((band) => [band.id, band]));
  return provider.bands.map((band) => ({
    ...byId.get(band.id),
    max: band.max,
  }));
}

/**
 * The numeric range a band covers, as the legend prints it: "0–50", "51–100",
 * "401+". Integer scales only; the lower bound is the previous band's max + 1.
 * @param {string} providerId
 * @returns {Map<string, string>} Band id → range text.
 */
export function providerBandRanges(providerId) {
  const ranges = new Map();
  let floor = 0;
  for (const band of airQualityProvider(providerId).bands) {
    ranges.set(
      band.id,
      Number.isFinite(band.max) ? `${floor}–${band.max}` : `${floor}+`,
    );
    floor = band.max + 1;
  }
  return ranges;
}

/** Band descriptor for an id on a provider's scale, or null. */
export function airQualityBandById(
  bandId,
  providerId = DEFAULT_AIR_QUALITY_PROVIDER_ID,
) {
  const key = String(bandId ?? '');
  return (
    airQualityProvider(providerId).bandScale.find((band) => band.id === key) ||
    null
  );
}

/**
 * Accent colour for a band id on the map (station circle, overlay bar and
 * leader), falling back to neutral grey. A band may name a separate
 * `mapColor` when its published colour is too dark for the map plate; the
 * legend swatch always shows the published `color`.
 */
export function airQualityColor(
  bandId,
  providerId = DEFAULT_AIR_QUALITY_PROVIDER_ID,
) {
  const band = airQualityBandById(bandId, providerId);
  return band?.mapColor || band?.color || AIR_QUALITY_UNKNOWN_COLOR;
}

/**
 * The published AQHI value for a raw ECCC reading: an integer from 1 up.
 *
 * ECCC reports whole numbers with a floor of 1 — there is no "AQHI 0" and no
 * "AQHI 1.08". A raw value below 1 is a legitimate low reading, not an error,
 * and is published as 1.
 *
 * @param {number|string|null|undefined} raw - Raw `aqhi` value from the API.
 * @returns {number|null} Published integer AQHI, or null when unusable.
 */
export function aqhiDisplayValue(raw) {
  // Guard the empty forms BEFORE coercing: Number(null) and Number('') are both
  // 0, which would otherwise floor to a confident "AQHI 1" for a station that
  // reported nothing at all.
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.max(1, Math.round(value));
}

/**
 * The published NAQI sub-index for one CPCB pollutant row: an integer from 0.
 *
 * data.gov.in writes "NA" for a pollutant the station did not report this
 * hour; that is a missing value, not a zero. There is no AQHI-style floor —
 * an AQI of 0 is a legitimate (if rare) reading.
 *
 * @param {number|string|null|undefined} raw
 * @returns {number|null}
 */
export function naqiDisplayValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || /^na$/i.test(trimmed)) return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * The band id for a value on a provider's scale.
 * @param {string} providerId
 * @param {number|null} value - Already in the provider's published form.
 * @returns {string|null}
 */
export function bandForValue(providerId, value) {
  const provider = AIR_QUALITY_PROVIDERS[String(providerId ?? '')];
  if (!provider || !Number.isFinite(value)) return null;
  return provider.bands.find((band) => value <= band.max)?.id ?? null;
}

/**
 * Display text for a value on a provider's scale.
 * AQHI collapses everything above ten into the open-ended "10+"; CPCB's
 * bulletin caps the published index at 500.
 * @param {string} providerId
 * @param {number|null} value
 * @returns {string}
 */
export function valueLabel(providerId, value) {
  if (!Number.isFinite(value)) return '--';
  if (providerId === 'eccc') return value > 10 ? '10+' : String(value);
  if (providerId === 'cpcb') return value > 500 ? '500+' : String(value);
  return String(value);
}

/** Plain-language risk phrase for a band id on a provider's scale. */
export function bandRiskText(
  bandId,
  providerId = DEFAULT_AIR_QUALITY_PROVIDER_ID,
) {
  return airQualityBandById(bandId, providerId)?.risk ?? null;
}

/**
 * Validate a station FeatureCollection into an id-keyed catalog.
 *
 * Atomic: a structurally broken response returns null so the caller keeps its
 * last good catalog. A station missing coordinates is skipped, since one
 * unusable station is not evidence the catalog is broken.
 *
 * @param {object} geojson - GeoJSON FeatureCollection from `aqhi-stations`.
 * @returns {Map<string, object>|null} Stations by location_id, or null.
 */
export function normalizeAqhiStations(geojson) {
  if (!Array.isArray(geojson?.features)) return null;
  const stations = new Map();
  for (const feature of geojson.features) {
    const properties = feature?.properties;
    if (
      !properties ||
      typeof properties !== 'object' ||
      Array.isArray(properties)
    )
      return null;
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lon, lat] = coordinates.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const id = String(properties.location_id ?? feature.id ?? '').trim();
    if (!id) continue;
    stations.set(id, {
      id,
      name: String(properties.location_name_en || id).trim(),
      // ECCC's administrative zone: atl, que, ont, pnr, pyr.
      zone: String(properties['eccc_administrative-zone'] || '').trim(),
      lat,
      lon,
    });
  }
  return stations;
}

/**
 * Join latest ECCC observations onto known stations into provider-shaped rows.
 *
 * The catalog is the only thing that supplies a reading its coordinates, so an
 * observation without a matching station cannot be placed and is dropped.
 * Readings older than OBSERVATION_MAX_AGE_MS are dropped too — a six-hour-old
 * air-quality number presented as current is worse than no number.
 *
 * @param {object} geojson - FeatureCollection from `aqhi-observations-realtime`.
 * @param {Map<string, object>} stations - Known stations by location_id.
 * @param {number} [now=Date.now()] - Clock seam for tests.
 * @returns {Array<object>|null} Normalized readings, or null when malformed.
 */
export function normalizeAqhiObservations(geojson, stations, now = Date.now()) {
  if (!Array.isArray(geojson?.features)) return null;
  if (!(stations instanceof Map)) return null;
  const provider = AIR_QUALITY_PROVIDERS.eccc;
  const newest = new Map();
  for (const feature of geojson.features) {
    const properties = feature?.properties;
    if (
      !properties ||
      typeof properties !== 'object' ||
      Array.isArray(properties)
    )
      return null;
    const stationId = String(properties.location_id ?? '').trim();
    const station = stations.get(stationId);
    if (!station) continue;

    const value = aqhiDisplayValue(properties.aqhi);
    if (value === null) continue;
    const observedMs = Date.parse(properties.observation_datetime);
    if (!Number.isFinite(observedMs)) continue;
    if (now - observedMs > provider.maxObservationAgeMs) continue;

    const previous = newest.get(stationId);
    if (previous && previous.observedMs >= observedMs) continue;
    const band = bandForValue(provider.id, value);
    newest.set(stationId, {
      id: `${provider.id}:${stationId}`,
      provider: provider.id,
      scale: provider.scale,
      value,
      band,
      stationId,
      name: station.name,
      zone: station.zone,
      lat: station.lat,
      lon: station.lon,
      observedMs,
      color: airQualityColor(band, provider.id),
      label: valueLabel(provider.id, value),
      risk: bandRiskText(band, provider.id),
      note: String(properties.special_notes_en || '').trim() || null,
    });
  }
  return [...newest.values()].sort(
    (a, b) => b.value - a.value || a.stationId.localeCompare(b.stationId),
  );
}

// ── CPCB (India) ───────────────────────────────────────────────────────────

/** The pollutant ids CPCB publishes, spelled as the feed spells them. */
export const CPCB_POLLUTANTS = Object.freeze([
  'PM2.5',
  'PM10',
  'NO2',
  'SO2',
  'CO',
  'OZONE',
  'NH3',
]);

/**
 * CPCB's rule for a valid station index: at least three pollutants reported,
 * one of them a particulate (PM2.5 or PM10). A station with fewer is shown
 * nowhere rather than as a confident number built from one gas.
 */
export const CPCB_MIN_POLLUTANTS = 3;

/**
 * Parse CPCB's `last_update` ("DD-MM-YYYY HH:mm:ss", IST) to epoch ms.
 * @param {string} text
 * @returns {number|null}
 */
export function parseCpcbTimestamp(text) {
  const match =
    /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(text ?? '').trim(),
    );
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const utc = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss ?? 0),
  );
  if (!Number.isFinite(utc)) return null;
  // The feed is wall-clock IST; the Date.UTC above read it as UTC.
  return utc - IST_OFFSET_MS;
}

/** Normalise the feed's pollutant spelling ("Ozone", "PM 2.5") to the canonical id. */
export function cpcbPollutantId(text) {
  const key = String(text ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (key === 'O3' || key === 'OZONE') return 'OZONE';
  if (key === 'PM2.5' || key === 'PM25') return 'PM2.5';
  return CPCB_POLLUTANTS.includes(key) ? key : null;
}

/**
 * A readable station name from CPCB's "Anand Vihar, Delhi - DPCC" form:
 * the locality before the first comma, with the operating agency dropped.
 */
export function cpcbStationName(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const locality = raw.split(',')[0].trim();
  return (locality || raw).replace(/\s+-\s+[A-Z]{2,6}$/, '').trim();
}

/**
 * Join CPCB's one-row-per-pollutant feed into one reading per station.
 *
 * A station's index is CPCB's own rule: the worst sub-index among the
 * pollutants it reported, provided at least three were reported and one is a
 * particulate. Rows older than the provider's max age are dropped, as are
 * "NA" sub-indices and rows without a usable coordinate. The dominant
 * pollutant is kept so the card can say *why* a station reads what it reads.
 *
 * Atomic: a structurally broken payload (no `records` array, or a row that is
 * not an object) returns null so the caller keeps its last good readings.
 *
 * @param {object} payload - `{records: Array<object>}` from the /api/cpcb proxy.
 * @param {number} [now=Date.now()] - Clock seam for tests.
 * @returns {Array<object>|null} Normalized readings, or null when malformed.
 */
export function normalizeCpcbReadings(payload, now = Date.now()) {
  if (!Array.isArray(payload?.records)) return null;
  const provider = AIR_QUALITY_PROVIDERS.cpcb;
  /** @type {Map<string, object>} */
  const stations = new Map();
  for (const row of payload.records) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const pollutant = cpcbPollutantId(row.pollutant_id);
    if (!pollutant) continue;
    const value = naqiDisplayValue(row.avg_value ?? row.pollutant_avg);
    if (value === null) continue;
    const observedMs = parseCpcbTimestamp(row.last_update);
    if (observedMs === null) continue;
    if (now - observedMs > provider.maxObservationAgeMs) continue;

    const stationText = String(row.station ?? '').trim();
    const city = String(row.city ?? '').trim();
    const state = String(row.state ?? '').trim();
    const stationId = [state, city, stationText]
      .map((part) =>
        part
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .filter(Boolean)
      .join('/');
    if (!stationId) continue;

    let station = stations.get(stationId);
    if (!station) {
      station = {
        stationId,
        name: cpcbStationName(stationText) || city || stationId,
        city,
        state,
        lat,
        lon,
        observedMs,
        pollutants: new Map(),
      };
      stations.set(stationId, station);
    }
    // A newer hour supersedes an older one for the same pollutant.
    const previous = station.pollutants.get(pollutant);
    if (previous && previous.observedMs > observedMs) continue;
    station.pollutants.set(pollutant, { value, observedMs });
    if (observedMs > station.observedMs) station.observedMs = observedMs;
  }

  const readings = [];
  for (const station of stations.values()) {
    const reported = [...station.pollutants.entries()];
    if (reported.length < CPCB_MIN_POLLUTANTS) continue;
    if (!station.pollutants.has('PM2.5') && !station.pollutants.has('PM10'))
      continue;
    let dominant = null;
    let value = null;
    for (const [pollutant, entry] of reported) {
      if (value === null || entry.value > value) {
        value = entry.value;
        dominant = pollutant;
      }
    }
    const band = bandForValue(provider.id, value);
    readings.push({
      id: `${provider.id}:${station.stationId}`,
      provider: provider.id,
      scale: provider.scale,
      value,
      band,
      stationId: station.stationId,
      name: station.name,
      zone: station.state,
      city: station.city,
      lat: station.lat,
      lon: station.lon,
      observedMs: station.observedMs,
      color: airQualityColor(band, provider.id),
      label: valueLabel(provider.id, value),
      risk: bandRiskText(band, provider.id),
      // The band in words, so a list row never relies on the accent colour.
      bandLabel: airQualityBandById(band, provider.id)?.label ?? null,
      dominant,
      note: null,
    });
  }
  return readings.sort(
    (a, b) => b.value - a.value || a.stationId.localeCompare(b.stationId),
  );
}

/**
 * Build the source-owned presentation for one station label.
 * @param {object} input
 * @returns {object}
 */
export function createAirQualityOverlayEntry({
  id,
  position,
  title,
  accent,
  value,
}) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    // Worse air wins the label budget — the reading people need to see first.
    priority: Math.round(Number(value) || 0) * 1000,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the worst readings, with stable identity as the tie-break. */
export function selectAirQualityOverlayCohort(
  entries,
  limit = AIR_QUALITY_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(AIR_QUALITY_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

/**
 * The worst readings inside a lon/lat rectangle, for the readout card.
 *
 * A null rectangle means the camera could not resolve one (a fully oblique or
 * space-level view); everything is then in scope rather than nothing, so the
 * card degrades to the worst readings overall instead of going blank.
 *
 * @param {Array<object>} readings
 * @param {?{west:number, south:number, east:number, north:number}} rect - Degrees.
 * @param {number} [limit=5]
 * @returns {Array<object>}
 */
export function readingsInView(readings, rect, limit = 5) {
  if (!Array.isArray(readings)) return [];
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  if (cap === 0) return [];
  const inside = !rect
    ? readings
    : readings.filter((reading) => {
        if (reading.lat < rect.south || reading.lat > rect.north) return false;
        // A rectangle crossing the antimeridian has west > east.
        return rect.west <= rect.east
          ? reading.lon >= rect.west && reading.lon <= rect.east
          : reading.lon >= rect.west || reading.lon <= rect.east;
      });
  return inside
    .slice()
    .sort((a, b) => b.value - a.value || a.stationId.localeCompare(b.stationId))
    .slice(0, cap);
}

/**
 * Map one reading to a JSON-safe analyst record. Pure — no Cesium types.
 * @param {object|null|undefined} raw
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.id) || `AIR-${String(index).padStart(4, '0')}`,
    provider: text(raw?.provider),
    scale: text(raw?.scale),
    value: num(raw?.value),
    band: text(raw?.band),
    bandLabel: text(raw?.bandLabel),
    name: text(raw?.name),
    zone: text(raw?.zone),
    city: text(raw?.city),
    dominant: text(raw?.dominant),
    risk: text(raw?.risk),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    observedMs: num(raw?.observedMs),
  };
}
