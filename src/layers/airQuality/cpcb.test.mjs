import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIR_QUALITY_PROVIDERS,
  NAQI_BANDS,
  airQualityColor,
  bandForValue,
  bandRiskText,
  cpcbStationName,
  naqiDisplayValue,
  normalizeCpcbReadings,
  parseCpcbTimestamp,
  providerBandRanges,
  providerBands,
  readingsAreStale,
  valueLabel,
} from './model.js';
import {
  createAirQualitySource,
  createCpcbAirQualitySource,
  resolveAirQualityProviderId,
} from './source.js';

// 17 Oct 2026 18:00 IST, as the feed writes it.
const LAST_UPDATE = '17-10-2026 18:00:00';
const OBSERVED_MS = Date.UTC(2026, 9, 17, 12, 30);
const NOW = OBSERVED_MS + 40 * 60_000;

const row = (pollutant, avg, overrides = {}) => ({
  country: 'India',
  state: 'Delhi',
  city: 'Delhi',
  station: 'Anand Vihar, Delhi - DPCC',
  last_update: LAST_UPDATE,
  latitude: '28.6468',
  longitude: '77.3160',
  pollutant_id: pollutant,
  min_value: '10',
  max_value: '500',
  avg_value: String(avg),
  ...overrides,
});

// ── scale ──────────────────────────────────────────────────────────────────

test('CPCB registers its own six NAQI bands on a 0–500 scale with a key', () => {
  const provider = AIR_QUALITY_PROVIDERS.cpcb;
  assert.equal(provider.scale, 'AQI');
  assert.equal(provider.requiresKeyId, 'cpcb');
  assert.match(provider.coverage, /India/);
  assert.deepEqual(
    providerBands('cpcb').map((b) => [b.id, b.max, b.label]),
    [
      ['good', 50, 'Good'],
      ['satisfactory', 100, 'Satisfactory'],
      ['moderate', 200, 'Moderate'],
      ['poor', 300, 'Poor'],
      ['very-poor', 400, 'Very Poor'],
      ['severe', Infinity, 'Severe'],
    ],
  );
  const colors = NAQI_BANDS.map((b) => b.color);
  assert.equal(new Set(colors).size, colors.length);
});

test('the legend prints each NAQI band with its numeric range', () => {
  assert.deepEqual(
    [...providerBandRanges('cpcb').entries()],
    [
      ['good', '0–50'],
      ['satisfactory', '51–100'],
      ['moderate', '101–200'],
      ['poor', '201–300'],
      ['very-poor', '301–400'],
      ['severe', '401+'],
    ],
  );
  assert.equal(AIR_QUALITY_PROVIDERS.cpcb.legendRanges, true);
  assert.equal(AIR_QUALITY_PROVIDERS.eccc.legendRanges, undefined);
});

test('CPCB thresholds are inclusive at the top of each band', () => {
  assert.equal(bandForValue('cpcb', 0), 'good');
  assert.equal(bandForValue('cpcb', 50), 'good');
  assert.equal(bandForValue('cpcb', 51), 'satisfactory');
  assert.equal(bandForValue('cpcb', 200), 'moderate');
  assert.equal(bandForValue('cpcb', 301), 'very-poor');
  assert.equal(bandForValue('cpcb', 401), 'severe');
  assert.equal(bandForValue('cpcb', 999), 'severe');
});

test('the two scales never share a band: moderate is yellow on NAQI, amber on AQHI', () => {
  assert.notEqual(airQualityColor('moderate', 'cpcb'), airQualityColor('moderate', 'eccc'));
  assert.equal(airQualityColor('moderate'), airQualityColor('moderate', 'eccc'));
  assert.equal(bandRiskText('severe', 'cpcb'), NAQI_BANDS[5].risk);
  assert.equal(bandRiskText('severe'), null);
  assert.equal(airQualityColor('low', 'cpcb'), '#6b7785');
});

test('CPCB values show as integers, capped at the bulletin ceiling, no AQHI floor', () => {
  assert.equal(naqiDisplayValue('0'), 0);
  assert.equal(naqiDisplayValue('NA'), null);
  assert.equal(naqiDisplayValue('na'), null);
  assert.equal(naqiDisplayValue(''), null);
  assert.equal(naqiDisplayValue('123.6'), 124);
  assert.equal(naqiDisplayValue('-1'), null);
  assert.equal(valueLabel('cpcb', 437), '437');
  assert.equal(valueLabel('cpcb', 512), '500+');
  assert.equal(valueLabel('cpcb', null), '--');
});

test('CPCB timestamps are wall-clock IST', () => {
  assert.equal(parseCpcbTimestamp(LAST_UPDATE), OBSERVED_MS);
  assert.equal(parseCpcbTimestamp('17-10-2026 18:00'), OBSERVED_MS);
  assert.equal(parseCpcbTimestamp('2026-10-17T18:00:00'), null);
  assert.equal(parseCpcbTimestamp(''), null);
  assert.equal(cpcbStationName('Anand Vihar, Delhi - DPCC'), 'Anand Vihar');
  assert.equal(cpcbStationName('Sector-22, Chandigarh - CPCC'), 'Sector-22');
  assert.equal(cpcbStationName('Punjabi Bagh - DPCC'), 'Punjabi Bagh');
});

// ── normalisation ──────────────────────────────────────────────────────────

test('one reading per station: the worst sub-index wins and names the pollutant', () => {
  const readings = normalizeCpcbReadings(
    {
      records: [
        row('PM2.5', 437),
        row('PM10', 380),
        row('NO2', 90),
        row('CO', 'NA'),
        row('OZONE', 22),
      ],
    },
    NOW,
  );
  assert.equal(readings.length, 1);
  const [reading] = readings;
  assert.equal(reading.id, 'cpcb:delhi/delhi/anand-vihar-delhi-dpcc');
  assert.equal(reading.provider, 'cpcb');
  assert.equal(reading.scale, 'AQI');
  assert.equal(reading.value, 437);
  assert.equal(reading.band, 'severe');
  assert.equal(reading.dominant, 'PM2.5');
  assert.equal(reading.name, 'Anand Vihar');
  assert.equal(reading.city, 'Delhi');
  assert.equal(reading.zone, 'Delhi');
  assert.equal(reading.lat, 28.6468);
  assert.equal(reading.lon, 77.316);
  assert.equal(reading.observedMs, OBSERVED_MS);
  // On the map the Severe maroon is lightened for contrast; the legend keeps it.
  assert.equal(reading.color, NAQI_BANDS[5].mapColor);
  assert.notEqual(reading.color, NAQI_BANDS[5].color);
  assert.equal(reading.bandLabel, 'Severe');
  assert.equal(reading.label, '437');
  assert.equal(reading.risk, NAQI_BANDS[5].risk);
});

test("CPCB's validity rule: three pollutants, one of them particulate", () => {
  const gasesOnly = normalizeCpcbReadings(
    { records: [row('NO2', 90), row('SO2', 20), row('CO', 30)] },
    NOW,
  );
  assert.equal(gasesOnly.length, 0);
  const tooFew = normalizeCpcbReadings(
    { records: [row('PM2.5', 300), row('NO2', 90)] },
    NOW,
  );
  assert.equal(tooFew.length, 0);
  const justEnough = normalizeCpcbReadings(
    { records: [row('PM10', 150), row('NO2', 90), row('CO', 30)] },
    NOW,
  );
  assert.equal(justEnough.length, 1);
  assert.equal(justEnough[0].dominant, 'PM10');
});

test('old hours, bad coordinates and unknown pollutants are dropped per row', () => {
  const readings = normalizeCpcbReadings(
    {
      records: [
        row('PM2.5', 200, { last_update: '17-10-2026 09:00:00' }), // 9 h old
        row('PM10', 180),
        row('NO2', 60),
        row('CO', 40),
        row('PM2.5', 999, { latitude: 'NA', longitude: 'NA' }),
        row('Benzene', 999),
      ],
    },
    NOW,
  );
  assert.equal(readings.length, 1);
  assert.equal(readings[0].value, 180);
  assert.equal(readings[0].dominant, 'PM10');
});

test('the newest hour wins per pollutant, worst-first across stations', () => {
  const readings = normalizeCpcbReadings(
    {
      records: [
        row('PM2.5', 100, { last_update: '17-10-2026 17:00:00' }),
        row('PM2.5', 250),
        row('PM10', 120),
        row('NO2', 40),
        row('PM2.5', 350, { station: 'Sector-22, Chandigarh', city: 'Chandigarh', state: 'Chandigarh', latitude: '30.7', longitude: '76.8' }),
        row('PM10', 300, { station: 'Sector-22, Chandigarh', city: 'Chandigarh', state: 'Chandigarh', latitude: '30.7', longitude: '76.8' }),
        row('SO2', 10, { station: 'Sector-22, Chandigarh', city: 'Chandigarh', state: 'Chandigarh', latitude: '30.7', longitude: '76.8' }),
      ],
    },
    NOW,
  );
  assert.deepEqual(
    readings.map((r) => [r.name, r.value]),
    [
      ['Sector-22', 350],
      ['Anand Vihar', 250],
    ],
  );
});

test('a malformed payload is null, an empty one is an empty list', () => {
  assert.equal(normalizeCpcbReadings({ records: 'nope' }, NOW), null);
  assert.equal(normalizeCpcbReadings({ records: [null] }, NOW), null);
  assert.equal(normalizeCpcbReadings(null, NOW), null);
  assert.deepEqual(normalizeCpcbReadings({ records: [] }, NOW), []);
});

test('the legacy pollutant_avg spelling still reads', () => {
  const legacy = (pollutant, avg) => ({
    ...row(pollutant, avg),
    avg_value: undefined,
    pollutant_avg: String(avg),
  });
  const readings = normalizeCpcbReadings(
    { records: [legacy('PM2.5', 120), legacy('PM10', 90), legacy('NO2', 30)] },
    NOW,
  );
  assert.equal(readings[0]?.value, 120);
});

test('CPCB stale line is three hours, judged on observation time', () => {
  const readings = normalizeCpcbReadings(
    { records: [row('PM2.5', 120), row('PM10', 90), row('NO2', 30)] },
    NOW,
  );
  const staleAfter = AIR_QUALITY_PROVIDERS.cpcb.staleAfterMs;
  assert.equal(staleAfter, 3 * 60 * 60 * 1000);
  assert.equal(readingsAreStale(readings, OBSERVED_MS + 2.5 * 3_600_000, staleAfter), false);
  assert.equal(readingsAreStale(readings, OBSERVED_MS + 3.5 * 3_600_000, staleAfter), true);
  // The ECCC default would already have called it stale.
  assert.equal(readingsAreStale(readings, OBSERVED_MS + 2.5 * 3_600_000), true);
});

// ── source ─────────────────────────────────────────────────────────────────

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() {
    return body;
  },
  async text() {
    return JSON.stringify(body);
  },
  body: null,
});

test('the CPCB source polls the proxy, names its provider and keeps its last good snapshot', async () => {
  const calls = [];
  const payload = {
    fetchedAt: NOW,
    records: [row('PM2.5', 200), row('PM10', 150), row('NO2', 40)],
  };
  let next = payload;
  const source = createCpcbAirQualitySource({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, next);
    },
    now: () => NOW,
  });
  assert.equal(source.providerId, 'cpcb');
  const first = await source.getSnapshot({});
  assert.equal(calls[0].url, '/api/cpcb');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(first.length, 1);
  assert.equal(first[0].value, 200);
  next = { fetchedAt: NOW, records: [] };
  const second = await source.getSnapshot({});
  assert.equal(second, first, 'an empty refresh keeps the last good readings');
});

test('the CPCB source reports a missing key as a step, and other failures as errors', async () => {
  const keyless = createCpcbAirQualitySource({
    fetchImpl: async () => jsonResponse(503, { error: 'no_key' }),
  });
  assert.deepEqual(await keyless.getSnapshot({}), { keyRequired: true });
  const down = createCpcbAirQualitySource({
    fetchImpl: async () => jsonResponse(502, { error: 'cpcb fetch failed' }),
  });
  await assert.rejects(down.getSnapshot({}), /CPCB HTTP 502/);
  const malformed = createCpcbAirQualitySource({
    fetchImpl: async () => jsonResponse(200, { records: 'nope' }),
  });
  await assert.rejects(malformed.getSnapshot({}), /Malformed CPCB response/);
});

test('the CPCB source honours the caller abort and its own deadline', async () => {
  const controller = new AbortController();
  controller.abort(new Error('gone'));
  const source = createCpcbAirQualitySource({
    fetchImpl: async () => {
      throw new Error('fetch must not run after abort');
    },
  });
  await assert.rejects(source.getSnapshot({ signal: controller.signal }), /gone/);
  const slow = createCpcbAirQualitySource({
    timeoutMs: 5,
    fetchImpl: (url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  await assert.rejects(slow.getSnapshot({}), /CPCB request timed out/);
});

test('the provider factory resolves ids and falls back to the first provider', () => {
  assert.equal(resolveAirQualityProviderId('CPCB'), 'cpcb');
  assert.equal(resolveAirQualityProviderId('eccc'), 'eccc');
  assert.equal(resolveAirQualityProviderId('waqi'), 'eccc');
  assert.equal(resolveAirQualityProviderId(undefined), 'eccc');
  assert.equal(createAirQualitySource({ providerId: 'cpcb' }).providerId, 'cpcb');
  assert.equal(createAirQualitySource().providerId, 'eccc');
});

// ── the live shape, as data.gov.in returned it on 18 Oct 2026 at 20:00 IST ──

const LIVE_ROWS = [
  ['Bihar', 'Araria', 'Kharahiya Basti, Araria - BSPCB', '26.146529', '87.454184', 'CO', '16', '36', '28'],
  ['Bihar', 'Araria', 'Kharahiya Basti, Araria - BSPCB', '26.146529', '87.454184', 'OZONE', '14', '14', '14'],
  ['Bihar', 'Aurangabad', 'Gurdeo Nagar, Aurangabad - BSPCB', '24.75746', '84.366208', 'PM2.5', '15', '68', '45'],
  ['Bihar', 'Begusarai', 'Lohiyanagar, Begusarai - BSPCB', '25.42742023', '86.13886079', 'NH3', '2', '3', '2'],
  ['Bihar', 'Bettiah', 'Kamalnath Nagar, Bettiah - BSPCB', '26.80365', '84.51954', 'PM10', '20', '23', '21'],
  ['Bihar', 'Bettiah', 'Kamalnath Nagar, Bettiah - BSPCB', '26.80365', '84.51954', 'SO2', '13', '22', '17'],
  ['Bihar', 'Bhagalpur', 'Mayaganj, Bhagalpur - BSPCB', '25.265194', '87.012947', 'PM2.5', '13', '302', '84'],
  ['Bihar', 'Bhagalpur', 'DM Office_Kachari Chowk, Bhagalpur - BSPCB', '25.251013', '86.989001', 'NH3', '4', '4', '4'],
  ['Bihar', 'Bihar Sharif', 'D M Colony, Bihar Sharif - BSPCB', '25.204762', '85.51496', 'PM2.5', '13', '193', '46'],
  ['Bihar', 'Buxar', 'Charitra Van, Buxar - BSPCB', '25.56752', '83.966379', 'NH3', '3', '3', '3'],
].map(([state, city, station, latitude, longitude, pollutant_id, min_value, max_value, avg_value]) => ({
  country: 'India',
  state,
  city,
  station,
  last_update: '18-10-2026 20:00:00',
  latitude,
  longitude,
  pollutant_id,
  min_value,
  max_value,
  avg_value,
}));
const LIVE_NOW = Date.UTC(2026, 9, 18, 14, 30) + 50 * 60_000; // 20:50 IST

test('the live data.gov.in shape parses, and a ten-row sample page qualifies no station', () => {
  // Every row is current and well-formed, but the sample key's ten rows give
  // no station three pollutants with a particulate, so CPCB's rule shows none.
  assert.equal(parseCpcbTimestamp(LIVE_ROWS[0].last_update), Date.UTC(2026, 9, 18, 14, 30));
  assert.deepEqual(normalizeCpcbReadings({ records: LIVE_ROWS }, LIVE_NOW), []);
});

test('with its other rows a live station reads its worst sub-index and names it', () => {
  const mayaganj = LIVE_ROWS.find((row) => row.station.startsWith('Mayaganj'));
  const extra = (pollutant_id, avg_value) => ({ ...mayaganj, pollutant_id, avg_value });
  const readings = normalizeCpcbReadings(
    { records: [...LIVE_ROWS, extra('PM10', '71'), extra('NO2', '12')] },
    LIVE_NOW,
  );
  assert.equal(readings.length, 1);
  const [reading] = readings;
  assert.equal(reading.name, 'Mayaganj');
  assert.equal(reading.city, 'Bhagalpur');
  assert.equal(reading.value, 84);
  assert.equal(reading.band, 'satisfactory');
  assert.equal(reading.bandLabel, 'Satisfactory');
  assert.equal(reading.dominant, 'PM2.5');
  assert.equal(reading.lat, 25.265194);
  assert.equal(reading.observedMs, Date.UTC(2026, 9, 18, 14, 30));
});

test('the region summary counts stations in the box, names the worst and the top two bands', async () => {
  const { summarizeAirQualityRegion } = await import('./model.js');
  const region = {
    id: 'delhi-ncr',
    label: 'Delhi NCR',
    bbox: { west: 76.75, south: 28.25, east: 77.65, north: 28.95 },
  };
  const station = (name, lat, lon, value, band) => ({
    name,
    lat,
    lon,
    value,
    band,
    label: String(value),
    bandLabel: band,
    color: '#000000',
    observedMs: 1,
  });
  const readings = [
    station('ITO', 28.63, 77.24, 425, 'severe'),
    station('Loni', 28.75, 77.28, 269, 'poor'),
    station('Anand Vihar', 28.65, 77.32, 310, 'very-poor'),
    station('Ludhiana', 30.9, 75.85, 180, 'moderate'),
    station('Unknown band', 28.6, 77.2, null, null),
  ];
  const summary = summarizeAirQualityRegion(readings, region, 'cpcb');
  assert.equal(summary.count, 4, 'four stations inside the box');
  assert.equal(summary.alertCount, 2, 'Severe and Very Poor');
  assert.equal(summary.worst.name, 'ITO');
  assert.equal(summary.worst.value, 425);
  assert.equal(summary.worst.bandLabel, 'severe');
  assert.deepEqual(summarizeAirQualityRegion([], region, 'cpcb'), {
    id: 'delhi-ncr',
    label: 'Delhi NCR',
    count: 0,
    alertCount: 0,
    worst: null,
  });
  assert.equal(summarizeAirQualityRegion(readings, null, 'cpcb'), null);
});
