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
