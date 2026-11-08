import * as Cesium from 'cesium';
import {
  infraLodBudget,
  shouldRecomputeInfraLod,
} from '../../data/localGeojsonLod.js';
import { msg, t } from '../../i18n/index.js';
import { UNKNOWN_TYPE_RANK, classifyFeatureType } from './classification.js';
import {
  SEAFLOOR_FAMILY_COLORS,
  SEAFLOOR_LABEL_MAX_DISTANCE_M,
  SEAFLOOR_LABEL_WINNER_CAP,
  SEAFLOOR_MINOR_CAMERA_HEIGHT_M,
  SEAFLOOR_OVERLAY_COLLISION_CAPACITY,
  SEAFLOOR_OVERLAY_SOURCE_ID,
  defaultSweepClock,
} from './policy.js';

/**
 * Display label: the gazetteer's NAME is the specific part only, so the
 * generic type completes it ("Mariana" + "Trench").
 * @param {{name?:string,type?:string}} feature
 * @param {number} [maxLength]
 * @returns {string}
 */
export function seafloorLabel(feature, maxLength = 40) {
  const text = `${feature?.name ?? ''} ${feature?.type ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

/**
 * Spoken word for each canonical type, kept in data for a later t(): the
 * visible label stays in the gazetteer's English ("Mariana Trench"), and the
 * screen-reader entry adds the type in the user's language.
 */
const TYPE_WORDS = Object.freeze({
  Trench: msg('trench'),
  Ridge: msg('ridge'),
  'Abyssal Plain': msg('abyssal plain'),
  'Fracture Zone': msg('fracture zone'),
  Plateau: msg('plateau'),
  Rise: msg('rise'),
  Basin: msg('basin'),
  Trough: msg('trough'),
  Escarpment: msg('escarpment'),
  Seamount: msg('seamount'),
  Guyot: msg('guyot'),
  Canyon: msg('canyon'),
  Bank: msg('bank'),
  Shelf: msg('shelf'),
  Slope: msg('slope'),
  Knoll: msg('knoll'),
  Hill: msg('hill'),
  Reef: msg('reef'),
  Shoal: msg('shoal'),
  Fan: msg('fan'),
  Hole: msg('hole'),
  Spur: msg('spur'),
  Valley: msg('valley'),
  Gap: msg('gap'),
  Passage: msg('passage'),
  Sill: msg('sill'),
  Channel: msg('channel'),
  Deep: msg('deep'),
  Scarp: msg('scarp'),
});

/**
 * Translated type word for a raw or canonical type ("Seamounts" -> "seamount").
 * @param {string} type
 * @returns {string}
 */
export function seafloorTypeWord(type) {
  const word = TYPE_WORDS[classifyFeatureType(type).type];
  return word ? t(word) : t('sea floor feature');
}

/**
 * Importance used for ordering: the size-adjusted prominence when the record
 * carries one, else its type rank. Lower is more important.
 * @param {{prominence?:number,rank?:number}} record
 * @returns {number}
 */
export function seafloorImportance(record) {
  if (Number.isFinite(record?.prominence)) return record.prominence;
  return Number.isFinite(record?.rank) ? record.rank : UNKNOWN_TYPE_RANK;
}

/**
 * Arbiter priority: importance first (a trench beats a seamount, a 40-degree
 * ridge beats a 1-degree one), distance second, quantized to 50 km buckets
 * so a creeping camera does not reshuffle labels.
 * @param {number} importance Rank or prominence; may be below 1.
 * @param {number} distanceM
 * @returns {number}
 */
export function seafloorLabelPriority(importance, distanceM) {
  const r = Number.isFinite(importance) ? importance : UNKNOWN_TYPE_RANK;
  const distance = Number.isFinite(distanceM)
    ? Math.max(0, distanceM)
    : SEAFLOOR_LABEL_MAX_DISTANCE_M;
  return 1000 - r * 25 - Math.round(distance / 50_000);
}

/**
 * Whether minor features may show at this camera height and names mode.
 * @param {{cameraHeightM?:number,names?:string}} view
 * @returns {boolean}
 */
export function minorFeaturesEligible({ cameraHeightM, names } = {}) {
  if (names === 'all') return true;
  return (
    Number.isFinite(cameraHeightM) &&
    cameraHeightM < SEAFLOOR_MINOR_CAMERA_HEIGHT_M
  );
}

/**
 * Label cap for the camera height: the shared infrastructure budget, which
 * is 80 at global framing (3,000 km and up) and never above the layer cap.
 * @param {number} cameraHeightM
 * @param {number} [limit]
 * @returns {number}
 */
export function seafloorLabelCap(
  cameraHeightM,
  limit = SEAFLOOR_LABEL_WINNER_CAP,
) {
  const requested = Math.floor(Number(limit) || 0);
  return Math.max(
    0,
    Math.min(
      SEAFLOOR_LABEL_WINNER_CAP,
      requested,
      infraLodBudget(cameraHeightM).activeLimit,
    ),
  );
}

/**
 * Select the records whose labels go to the host: visible, in range, and
 * either major or admitted by the minor gate; ranked by importance (size-
 * adjusted rank), then proximity, then id for a deterministic cut.
 * @param {object[]} records Records with `visible`, `distanceM`, `kind`, `rank`, `label`, `id`.
 * @param {{cameraHeightM?:number,names?:string,limit?:number}} [view]
 * @returns {object[]}
 */
export function selectSeafloorLabelWinners(
  records,
  { cameraHeightM, names = 'major', limit = SEAFLOOR_LABEL_WINNER_CAP } = {},
) {
  const cap = seafloorLabelCap(cameraHeightM, limit);
  if (!Array.isArray(records) || cap === 0) return [];
  const minorOk = minorFeaturesEligible({ cameraHeightM, names });
  return records
    .filter(
      (record) =>
        record?.visible === true &&
        record.label &&
        Number.isFinite(record.distanceM) &&
        record.distanceM <= SEAFLOOR_LABEL_MAX_DISTANCE_M &&
        (record.kind === 'major' || minorOk),
    )
    .sort(
      (a, b) =>
        seafloorImportance(a) - seafloorImportance(b) ||
        a.distanceM - b.distanceM ||
        String(a.id || '').localeCompare(String(b.id || '')),
    )
    .slice(0, cap);
}

/**
 * Build one shared-host ambient label for a feature record. Created once per
 * record and attached to its anchor Cartesian; only `priority` is refreshed
 * per sweep. Interactive with `accessibilityLabel` and `activate`, which is
 * what puts the feature into the host's screen-reader list of visible map
 * targets; activating it selects the same context a click on the anchor does.
 * @param {object} record Feature record ({ id, label, type, family, rank, prominence, anchor, distanceM }).
 * @param {{activate?: function(): *}} [options]
 * @returns {object}
 */
export function createSeafloorOverlayEntry(record, { activate } = {}) {
  const label = String(record?.label || '');
  const entry = {
    id: String(record?.id || ''),
    position: record?.anchor,
    variant: 'label',
    title: label,
    accessibilityLabel: `${label}, ${seafloorTypeWord(record?.type)}`,
    accent:
      SEAFLOOR_FAMILY_COLORS[record?.family] || SEAFLOOR_FAMILY_COLORS.other,
    priority: seafloorLabelPriority(
      seafloorImportance(record),
      record?.distanceM,
    ),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: true,
    minDistance: 0,
    maxDistance: SEAFLOOR_LABEL_MAX_DISTANCE_M,
    distanceFadeStartRatio: 0.7,
    distanceScale: {
      near: 250000,
      nearValue: 1,
      far: 9000000,
      farValue: 0.62,
    },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    // No stem lifts the label: the anchor sits on the sea surface, so a
    // smaller gap than the cables' 14 px keeps text and dot read as one.
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
  };
  if (typeof activate === 'function') entry.activate = activate;
  return entry;
}

/**
 * Bind the layer's host visibility and entry lifecycle to the shared world
 * overlay (same contract as the cables publisher): show, publish, hide.
 * @param {object} [options]
 * @param {string} [options.sourceId]
 * @param {object} [options.host] Test seam for the three host lifecycle calls.
 * @returns {{show:function():void,publish:function(object[]):void,hide:function():void}}
 */
export function createSeafloorOverlayPublisher({
  sourceId = SEAFLOOR_OVERLAY_SOURCE_ID,
  host,
} = {}) {
  let visible = false;
  let published = false;
  const sourceOptions = {
    cohortLimit: SEAFLOOR_LABEL_WINNER_CAP,
    collisionCapacity: SEAFLOOR_OVERLAY_COLLISION_CAPACITY,
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
  };
}

/**
 * Dirty gate for the visibility sweep: runs on the first frame after a
 * `moveEnd`, enable, load or param change, and otherwise only when the
 * shared infrastructure motion probe (`shouldRecomputeInfraLod`) reports
 * that a camera which never emits `moveEnd` (tracking, orbit) has travelled
 * past its height-scaled epsilon since the last sweep. A parked camera costs
 * one clock read per frame and zero sweeps.
 * @param {object} [options]
 * @param {function():number} [options.now] Monotonic clock (test seam).
 */
export function createSeafloorSweepGate({ now = defaultSweepClock } = {}) {
  const lastSwept = new Cesium.Cartesian3();
  let hasSwept = false;
  let dirty = true;
  let lastProbeMs = Number.NEGATIVE_INFINITY;

  function accept(camera) {
    const position = camera?.positionWC;
    hasSwept = Boolean(position);
    if (position) Cesium.Cartesian3.clone(position, lastSwept);
    return true;
  }

  return {
    markDirty() {
      dirty = true;
    },
    /**
     * @param {Cesium.Camera} [camera] Live camera; omit for a dirty-only gate.
     * @param {number} [cameraHeightM] Height from the last sweep, for the epsilon.
     * @returns {boolean}
     */
    shouldRun(camera, cameraHeightM) {
      if (dirty) {
        dirty = false;
        return accept(camera);
      }
      const position = camera?.positionWC;
      if (!position) return false;
      if (!hasSwept) return accept(camera);
      const probe = shouldRecomputeInfraLod({
        nowMs: now(),
        lastProbeMs,
        movedSqM: Cesium.Cartesian3.distanceSquared(position, lastSwept),
        cameraHeightM,
      });
      lastProbeMs = probe.lastProbeMs;
      return probe.recompute ? accept(camera) : false;
    },
    reset() {
      dirty = true;
      hasSwept = false;
      lastProbeMs = Number.NEGATIVE_INFINITY;
    },
  };
}
