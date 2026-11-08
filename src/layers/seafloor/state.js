import * as Cesium from 'cesium';
import {
  createSeafloorOverlayPublisher,
  createSeafloorSweepGate,
} from './overlay.js';
import {
  PLATE_CLASS_ALPHA,
  PLATE_CLASS_COLORS,
  PLATE_DASHED_CLASSES,
  SEAFLOOR_ANCHOR_ALPHA,
  SEAFLOOR_DASHED_FAMILIES,
  SEAFLOOR_DASH_LENGTH_PX,
  SEAFLOOR_DEFAULT_PARAMS,
  SEAFLOOR_FAMILY_COLORS,
  SEAFLOOR_LINE_ALPHA,
  SEAFLOOR_OUTLINE_ALPHA,
} from './policy.js';

/** Solid or dashed line material; the dash is a pattern cue, not decoration. */
function lineMaterial(color, dashed) {
  return dashed
    ? new Cesium.PolylineDashMaterialProperty({
        color,
        dashLength: SEAFLOOR_DASH_LENGTH_PX,
      })
    : new Cesium.ColorMaterialProperty(color);
}

/** One Cesium colour and material per family and plate class, shared by every entity. */
function buildPalette() {
  const anchors = {};
  const lines = {};
  const outlines = {};
  for (const [family, css] of Object.entries(SEAFLOOR_FAMILY_COLORS)) {
    const color = Cesium.Color.fromCssColorString(css);
    const dashed = SEAFLOOR_DASHED_FAMILIES.has(family);
    anchors[family] = {
      major: color.withAlpha(SEAFLOOR_ANCHOR_ALPHA.major),
      minor: color.withAlpha(SEAFLOOR_ANCHOR_ALPHA.minor),
    };
    lines[family] = lineMaterial(color.withAlpha(SEAFLOOR_LINE_ALPHA), dashed);
    outlines[family] = lineMaterial(
      color.withAlpha(SEAFLOOR_OUTLINE_ALPHA),
      dashed,
    );
  }
  const plates = {};
  for (const [code, css] of Object.entries(PLATE_CLASS_COLORS)) {
    plates[code] = lineMaterial(
      Cesium.Color.fromCssColorString(css).withAlpha(
        PLATE_CLASS_ALPHA[code] ?? 0.9,
      ),
      PLATE_DASHED_CLASSES.has(code),
    );
  }
  return {
    anchors,
    lines,
    outlines,
    plates,
    anchorOutline: Cesium.Color.BLACK.withAlpha(0.65),
  };
}

/**
 * Mutable layer state shared by the rendering, ingestion, interaction and
 * lifecycle parts.
 * @param {object} options
 * @param {object} options.overlayHost World-overlay host (setVisible/setEntries/clearSource).
 * @param {function():number} [options.sweepClock]
 */
export function createState({ overlayHost, sweepClock }) {
  const state = {};

  state._viewer = null;
  state._enabled = false;
  state._loading = false;
  state._loaded = false;
  state._count = 0;
  state._plateCount = 0;
  state._error = null;
  state._lastUpdate = null;
  state._loadingLabel = '';
  state._abort = null;

  /** Monotonic load-ownership token; every load() start claims a new one. */
  state._loadGeneration = 0;

  state._featureDataSource = null;
  state._plateDataSource = null;

  /**
   * Parsed bundles kept across disable/enable. A disable RELEASES the data
   * sources (hidden sources still cost every frame), so a re-enable rebuilds
   * the entities; the fetch and parse half of that is what is cached.
   */
  state._cachedBundle = null;

  state._records = [];
  state._plateRecords = [];
  state._pickByEntity = new WeakMap();

  state._params = { ...SEAFLOOR_DEFAULT_PARAMS };

  /** Live legend counts, filled at load. */
  state._familyCounts = {};
  state._plateClassCounts = {};

  state._labelCount = 0;
  state._cameraHeightM = null;
  /** Sweep counter that marks the anchors whose names are on screen. */
  state._anchorStamp = 0;

  state._clickHandler = null;
  state._preRenderRemover = null;
  state._moveEndRemover = null;
  state._mapStackListener = null;
  state._rowControlsListener = null;

  /** Active ground-line classification; refined from live scene state at init. */
  state._classificationType = Cesium.ClassificationType.BOTH;

  /** Map stack ids seen on 'gev:map-stack-changed', for the Sea floor map chip. */
  state._activeStackId = null;
  state._previousStackId = null;

  /** True from a chip click until the shell answers with a stack change (or times out). */
  state._mapStackRequestPending = false;
  state._mapStackRequestTimer = null;

  state._sweepGate = createSeafloorSweepGate({ now: sweepClock });
  state._overlayPublisher = createSeafloorOverlayPublisher({
    host: overlayHost,
  });

  /** Reused winner -> entry scratch so a sweep allocates no arrays. */
  state._publishScratch = [];

  /**
   * Last published cohort signature (ids + quantized priorities). A parked
   * camera reproduces the same winners every sweep; skipping the identical
   * republish keeps the host from requesting a render per publish.
   */
  state._lastPublishedIds = [];
  state._lastPublishedPriorities = [];
  state._lastPublishedCount = -1;

  state.palette = buildPalette();
  return state;
}
