import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { readResponseJsonCapped } from './common/http.js';

/**
 * CPCB real-time air-quality proxy (India) with a memory + disk cache.
 *
 * Upstream: data.gov.in resource "Real time Air Quality Index from various
 * location" — the CPCB CAAQMS network published hourly through the Open
 * Government Data platform. One row per station × pollutant with the
 * pollutant's sub-index (min / max / avg over the trailing 24 h window).
 *
 *   https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69
 *
 * The key is SERVER-SIDE ONLY (`CPCB_API_KEY`): the browser polls this proxy,
 * which also sidesteps the platform's missing CORS headers. CPCB publishes
 * hourly, so the cache is the point: TTL 20 min, single-flight refresh,
 * serve-stale-on-failure, and a fresh-enough disk cache
 * (.gev-cache/cpcb.json) prevents an upstream fetch across dev-server
 * restarts. Pattern mirrors firmsProxy / celestrakProxy.
 *
 * Routes:
 *   GET /api/cpcb        → {fetchedAt, stale, ttlMs, count, records}
 *   GET /api/cpcb/status → {hasKey, lastFetch, count, stale, ttlMs}
 *
 * Keyless (no CPCB_API_KEY): /api/cpcb → 503 {error:'no_key'}; status →
 * {hasKey:false}. Upstream is never touched without a key.
 *
 * @returns {import('vite').Plugin}
 */

export const CPCB_RESOURCE_ID = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
export const CPCB_UPSTREAM_URL = `https://api.data.gov.in/resource/${CPCB_RESOURCE_ID}`;
export const CPCB_TTL_MS = 20 * 60_000;
/**
 * data.gov.in pages its resources; the full network is ~3,750 rows (one per
 * station × pollutant). A key may be capped below the limit it is asked for
 * — the public sample key returns at most 10 rows a call — so the walk steps
 * by the rows actually returned, and the page cap bounds a capped key rather
 * than trusting the limit.
 */
export const CPCB_PAGE_LIMIT = 1000;
export const CPCB_MAX_PAGES = 60;
/** A 1,000-row page is a few hundred KB; anything past this is not a page. */
export const CPCB_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// data.gov.in has answered a 1000-row page in 25–30 s on busy evenings
// (19 Oct 2026); a shorter deadline turned a slow upstream into no rows.
const PAGE_TIMEOUT_MS = 45_000;

/** The fields the client needs, under either of data.gov.in's two spellings. */
const RECORD_FIELDS = Object.freeze([
  'country',
  'state',
  'city',
  'station',
  'last_update',
  'latitude',
  'longitude',
  'pollutant_id',
]);
const VALUE_FIELDS = Object.freeze({
  min_value: ['min_value', 'pollutant_min'],
  max_value: ['max_value', 'pollutant_max'],
  avg_value: ['avg_value', 'pollutant_avg'],
});

const text = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/**
 * Keep only the fields the browser consumes, normalising the platform's two
 * historical column spellings (`avg_value` vs `pollutant_avg`) to one. Pure.
 * @param {object} record - One upstream row.
 * @returns {object|null} Trimmed row, or null when it is not an object.
 */
export function trimCpcbRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    return null;
  const out = {};
  for (const field of RECORD_FIELDS) out[field] = text(record[field]);
  for (const [field, aliases] of Object.entries(VALUE_FIELDS)) {
    const alias = aliases.find((name) => text(record[name]) !== '');
    out[field] = alias ? text(record[alias]) : '';
  }
  return out;
}

/**
 * Trim a page of upstream rows. Pure.
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function trimCpcbRecords(records) {
  if (!Array.isArray(records)) return [];
  const out = [];
  for (const record of records) {
    const trimmed = trimCpcbRecord(record);
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Build the upstream page URL. Exported for tests; never log its output — it
 * embeds the API key.
 */
export function cpcbPageUrl(key, offset, limit = CPCB_PAGE_LIMIT) {
  const url = new URL(CPCB_UPSTREAM_URL);
  url.searchParams.set('api-key', key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  return url.toString();
}

export function cpcbProxy({
  fetchImpl = (...args) => fetch(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
  apiKey = () => String(process.env.CPCB_API_KEY || '').trim(),
  // data.gov.in can take half a minute on a cold walk, longer than a
  // browser waits. With a key and no fresh cache the server starts that walk
  // at boot, in the background, so the first visitor reads from memory.
  warmOnStart = true,
} = {}) {
  const CACHE_DIR = cacheDir;
  const CACHE_PATH = path.join(CACHE_DIR, 'cpcb.json');

  /** @type {?{at: number, count: number, pages: number, records: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.records)) {
        mem = parsed;
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[cpcb-proxy] cache write failed:', err?.message || err);
    }
  }

  /**
   * Fetch one page. Throws on HTTP error, a non-JSON body, or a body without
   * a `records` array (the platform reports errors as JSON `{error}` or an
   * HTML page). Never log the URL — it embeds the key.
   */
  async function fetchPage(key, offset) {
    const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const res = await fetchImpl(cpcbPageUrl(key, offset), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await readResponseJsonCapped(
      res,
      CPCB_MAX_RESPONSE_BYTES,
      signal,
    );
    if (!Array.isArray(body?.records))
      throw new Error(
        body?.error
          ? `upstream error: ${String(body.error).slice(0, 80)}`
          : 'no records array in upstream response',
      );
    const total = Number(body.total);
    return {
      records: trimCpcbRecords(body.records),
      total: Number.isFinite(total) ? total : null,
    };
  }

  /**
   * Walk the pages sequentially until the platform's reported total, stepping
   * by the rows each page actually returned. An empty page ends the walk; so
   * does the page cap, which turns a 10-row-capped key into a bounded, if
   * partial, snapshot rather than an endless one.
   */
  async function refreshUpstream(key) {
    const now = Date.now();
    const records = [];
    let pages = 0;
    let total = null;
    let offset = 0;
    while (pages < CPCB_MAX_PAGES) {
      const page = await fetchPage(key, offset);
      pages += 1;
      if (page.records.length === 0) break;
      for (const record of page.records) records.push(record);
      offset += page.records.length;
      if (total === null) total = page.total;
      if (total !== null && records.length >= total) break;
    }
    if (records.length === 0) throw new Error('upstream returned no rows');
    return {
      at: now,
      count: records.length,
      total,
      complete: total === null || records.length >= total,
      pages,
      records,
    };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: CPCB_TTL_MS,
      count: entry.records.length,
      // Rows the platform said exist, and whether the walk reached them all
      // (a capped key cannot). Absent from cache entries written before this.
      total: entry.total ?? null,
      complete: entry.complete ?? true,
      records: entry.records,
    };
  }

  /** Single-flight refresh; resolves to the fresh entry or null on failure. */
  function refreshOnce(key) {
    if (!inflight) {
      inflight = refreshUpstream(key)
        .then(async (fresh) => {
          mem = fresh;
          await writeDisk(fresh);
          return fresh;
        })
        .catch((err) => {
          console.warn(
            `[cpcb-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
          );
          return null;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  async function warmCache() {
    try {
      await readDiskOnce();
      const key = apiKey();
      if (!key) return;
      if (mem && Date.now() - mem.at < CPCB_TTL_MS) return;
      await refreshOnce(key);
    } catch {
      /* a warm-up never fails the server; the next request refreshes */
    }
  }

  const installMiddleware = (server) => {
    if (warmOnStart) void warmCache();
    server.middlewares.use('/api/cpcb', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        const key = apiKey();
        await readDiskOnce();

        if (subPath === '/status') {
          sendJson(200, {
            hasKey: Boolean(key),
            lastFetch: mem ? mem.at : null,
            count: mem ? mem.records.length : null,
            total: mem?.total ?? null,
            complete: mem ? (mem.complete ?? true) : null,
            stale: mem ? Date.now() - mem.at >= CPCB_TTL_MS : false,
            ttlMs: CPCB_TTL_MS,
          });
          return;
        }

        if (!key) {
          sendJson(503, { error: 'no_key' });
          return;
        }

        const entry = mem;
        if (entry && Date.now() - entry.at < CPCB_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // Stale or missing → refresh, single-flight (shared with the boot
        // warm-up, so a visitor arriving mid-walk joins it instead of
        // starting a second one).
        const fresh = await refreshOnce(key);
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, { error: 'cpcb fetch failed and no cache available' });
        }
      } catch (err) {
        console.warn('[cpcb-proxy] error:', err?.message || err);
        sendJson(500, { error: 'cpcb proxy error' });
      }
    });
  };
  return {
    name: 'cpcb-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
