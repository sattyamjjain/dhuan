/**
 * @module hudFireCounter
 *
 * The HUD's fire-count segment, read from the fire layer's regional stats.
 * Pure: takes the layer manager's `getAll()` rows and returns a number and a
 * code, or null when there is nothing honest to show (layer off, no key, no
 * refresh yet, region not configured).
 */
export const FIRE_LAYER_ID = 'local-firms';

/**
 * @param {Array<{id: string, enabled: boolean, stats?: object}>} layers
 * @param {string} regionId
 * @returns {{count: number, label: string}|null}
 */
export function fireCounterForHud(layers, regionId) {
  if (!Array.isArray(layers) || !regionId) return null;
  const fires = layers.find((layer) => layer?.id === FIRE_LAYER_ID);
  if (!fires?.enabled) return null;
  const stats = fires.stats || {};
  if (stats.keyRequired === true || !stats.lastUpdate) return null;
  const region = (stats.regions || []).find((row) => row?.id === regionId);
  if (!region) return null;
  const count = Number(region.count);
  if (!Number.isFinite(count) || count < 0) return null;
  return { count, label: String(region.shortLabel || region.id) };
}
