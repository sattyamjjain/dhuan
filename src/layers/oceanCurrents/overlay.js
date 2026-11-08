import { t } from '../../i18n/index.js';
import { currentColor, currentLabelPriority } from './model.js';
import {
  DISPLAY_HEIGHT_METERS,
  LABEL_MAX_DISTANCE_M,
  OVERLAY_COHORT_LIMIT,
  OVERLAY_COLLISION_CAPACITY,
  OVERLAY_SOURCE_ID,
} from './policy.js';

/** The temperature as words, so warm and cold never rest on colour alone. */
function temperatureWord(temp) {
  return temp === 'cold' ? t('cold current') : t('warm current');
}

/**
 * One shared-host ambient label per current, hung from its middle vertex.
 * Positions and priorities are static, so the entry is built once per load;
 * the host horizon-culls and distance-fades it per frame on its own. The
 * title carries the temperature word beside the name (the label painter
 * draws only the title), and `accessibilityLabel` plus `activate` put the
 * current into the host's screen-reader list of visible map targets, which
 * only lists interactive entries.
 * @param {object} record Normalised current record.
 * @param {object} position Cartesian3 at the lifted reference point.
 * @param {{activate?: function(): *}} [options]
 * @returns {object} World-overlay entry.
 */
export function createCurrentOverlayEntry(record, position, { activate } = {}) {
  const word = temperatureWord(record.temp);
  const entry = {
    id: `ocean-current-${record.id}`,
    position,
    variant: 'label',
    title: `${record.name} · ${word}`,
    accessibilityLabel: `${record.name}, ${word}`,
    accent: currentColor(record.temp),
    priority: currentLabelPriority(record.rank),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: true,
    minDistance: 0,
    maxDistance: LABEL_MAX_DISTANCE_M,
    distanceFadeStartRatio: 0.85,
    distanceScale: {
      near: 2_000_000,
      nearValue: 1,
      far: 25_000_000,
      farValue: 0.72,
    },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 6,
    placement: 'above',
  };
  if (typeof activate === 'function') entry.activate = activate;
  return entry;
}

/**
 * Entries for every record, positioned at the display lift so the label sits
 * on the drawn line rather than under it.
 * @param {object[]} records
 * @param {object} cesium Namespace with `Cartesian3.fromDegrees`.
 * @param {{activate?: function(object): *}} [options] Called with the record
 *   when the host activates the label from keyboard or assistive technology.
 * @returns {object[]}
 */
export function currentOverlayEntries(records, cesium, { activate } = {}) {
  return (records ?? []).map((record) =>
    createCurrentOverlayEntry(
      record,
      cesium.Cartesian3.fromDegrees(
        record.reference[0],
        record.reference[1],
        DISPLAY_HEIGHT_METERS,
      ),
      {
        activate:
          typeof activate === 'function' ? () => activate(record) : undefined,
      },
    ),
  );
}

/**
 * Bind the layer's host visibility and entry lifecycle to the shared world
 * overlay (the cables publisher contract). Teardown is hide(): clear the
 * published source and go invisible while staying reusable, since a hidden
 * publisher already drops late publishes until the next show().
 * @param {{host: object, sourceId?: string}} options
 * @returns {{show: function(): void, publish: function(object[]): void, hide: function(): void, isVisible: function(): boolean}}
 */
export function createCurrentOverlayPublisher({
  host,
  sourceId = OVERLAY_SOURCE_ID,
}) {
  let visible = false;
  let published = false;
  const sourceOptions = {
    cohortLimit: OVERLAY_COHORT_LIMIT,
    collisionCapacity: OVERLAY_COLLISION_CAPACITY,
    moving: false,
  };
  return {
    show() {
      if (visible) return;
      visible = true;
      host.setVisible(sourceId, true);
    },
    publish(entries) {
      if (!visible) return;
      host.setEntries(sourceId, entries, sourceOptions);
      published = entries.length > 0;
    },
    hide() {
      if (published) host.clearSource(sourceId);
      if (visible) host.setVisible(sourceId, false);
      visible = false;
      published = false;
    },
    isVisible: () => visible,
  };
}
