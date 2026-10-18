import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CPCB_RESOURCE_ID,
  cpcbPageUrl,
  trimCpcbRecord,
  trimCpcbRecords,
} from '../../server/providers/cpcb.js';
import { localProviderPlugins } from '../../server/providers/local.js';

test('the CPCB proxy is mounted with the other local providers', () => {
  const names = localProviderPlugins().map((plugin) => plugin.name);
  assert.ok(names.includes('cpcb-proxy'));
  assert.ok(names.indexOf('cpcb-proxy') > names.indexOf('firms-proxy'));
});

test('a page URL carries the resource, the key and JSON paging, nothing else', () => {
  const url = new URL(cpcbPageUrl('k-123', 2000, 1000));
  assert.equal(url.hostname, 'api.data.gov.in');
  assert.equal(url.pathname, `/resource/${CPCB_RESOURCE_ID}`);
  assert.equal(url.searchParams.get('api-key'), 'k-123');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('limit'), '1000');
  assert.equal(url.searchParams.get('offset'), '2000');
  assert.equal([...url.searchParams.keys()].length, 4);
});

test('rows are trimmed to the client fields under either column spelling', () => {
  const modern = trimCpcbRecord({
    country: 'India',
    state: 'Delhi',
    city: 'Delhi',
    station: 'Anand Vihar, Delhi - DPCC',
    last_update: '17-10-2026 18:00:00',
    latitude: '28.6468',
    longitude: '77.3160',
    pollutant_id: 'PM2.5',
    min_value: '120',
    max_value: '500',
    avg_value: '437',
    pollutant_unit: 'ug/m3',
    something_private: 'x',
  });
  assert.deepEqual(modern, {
    country: 'India',
    state: 'Delhi',
    city: 'Delhi',
    station: 'Anand Vihar, Delhi - DPCC',
    last_update: '17-10-2026 18:00:00',
    latitude: '28.6468',
    longitude: '77.3160',
    pollutant_id: 'PM2.5',
    min_value: '120',
    max_value: '500',
    avg_value: '437',
  });
  const legacy = trimCpcbRecord({
    station: ' X ',
    pollutant_id: 'PM10',
    pollutant_min: 1,
    pollutant_max: 2,
    pollutant_avg: 'NA',
  });
  assert.equal(legacy.station, 'X');
  assert.equal(legacy.min_value, '1');
  assert.equal(legacy.max_value, '2');
  assert.equal(legacy.avg_value, 'NA');
  assert.equal(legacy.latitude, '');
  assert.equal(trimCpcbRecord(null), null);
  assert.equal(trimCpcbRecord([1]), null);
  assert.deepEqual(trimCpcbRecords('nope'), []);
  assert.equal(trimCpcbRecords([null, { station: 'A' }]).length, 1);
});

// ── the walk, against a key capped below the page limit ──────────────────────

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cpcbProxy } from '../../server/providers/cpcb.js';

const REAL_ROW = {
  country: 'India',
  state: 'Bihar',
  city: 'Bhagalpur',
  station: 'Mayaganj, Bhagalpur - BSPCB',
  last_update: '18-10-2026 20:00:00',
  latitude: '25.265194',
  longitude: '87.012947',
  pollutant_id: 'PM2.5',
  min_value: '13',
  max_value: '302',
  avg_value: '84',
};

function fakeServer() {
  const routes = new Map();
  return {
    middlewares: {
      use(route, handler) {
        routes.set(route, handler);
      },
    },
    routes,
  };
}

async function call(handler, url) {
  let status = null;
  let body = '';
  const res = {
    headersSent: false,
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(text) {
      body = text;
    },
  };
  await handler({ url }, res);
  return { status, json: body ? JSON.parse(body) : null };
}

test('the proxy walks a key capped at 10 rows a page until the reported total', async (t) => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dhuan-cpcb-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const total = 25;
  const requested = [];
  const plugin = cpcbProxy({
    cacheDir,
    apiKey: () => 'personal-key',
    fetchImpl: async (url) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset'));
      requested.push([offset, Number(u.searchParams.get('limit'))]);
      // The platform honours a smaller cap than the limit asked for.
      const rows = Array.from(
        { length: Math.max(0, Math.min(10, total - offset)) },
        (_, i) => ({ ...REAL_ROW, station: `S${offset + i}` }),
      );
      return new Response(
        JSON.stringify({ total, count: rows.length, limit: 10, offset, records: rows }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const server = fakeServer();
  plugin.configureServer(server);
  const handler = server.routes.get('/api/cpcb');

  const first = await call(handler, '/');
  assert.equal(first.status, 200);
  assert.equal(first.json.count, 25);
  assert.equal(first.json.total, 25);
  assert.equal(first.json.complete, true);
  assert.equal(first.json.stale, false);
  assert.deepEqual(requested.map(([offset]) => offset), [0, 10, 20]);
  assert.deepEqual(Object.keys(first.json.records[0]), [
    'country', 'state', 'city', 'station', 'last_update',
    'latitude', 'longitude', 'pollutant_id', 'min_value', 'max_value', 'avg_value',
  ]);

  // Within the TTL the cache answers; upstream is not touched again.
  const second = await call(handler, '/');
  assert.equal(second.json.count, 25);
  assert.equal(requested.length, 3);

  const status = await call(handler, '/status');
  assert.equal(status.json.hasKey, true);
  assert.equal(status.json.count, 25);
  assert.equal(status.json.complete, true);
});

test('without a key the proxy answers 503 no_key and never calls upstream', async (t) => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dhuan-cpcb-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const plugin = cpcbProxy({
    cacheDir,
    apiKey: () => '',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not fetch');
    },
  });
  const server = fakeServer();
  plugin.configureServer(server);
  const handler = server.routes.get('/api/cpcb');
  const keyless = await call(handler, '/');
  assert.equal(keyless.status, 503);
  assert.deepEqual(keyless.json, { error: 'no_key' });
  const status = await call(handler, '/status');
  assert.equal(status.json.hasKey, false);
  assert.equal(calls, 0);
});

test('an upstream error page is a failure, and a failure with no cache is a 502', async (t) => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dhuan-cpcb-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const plugin = cpcbProxy({
    cacheDir,
    apiKey: () => 'k',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const server = fakeServer();
  plugin.configureServer(server);
  const handler = server.routes.get('/api/cpcb');
  const down = await call(handler, '/');
  assert.equal(down.status, 502);
});
