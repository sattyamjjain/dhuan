import * as Cesium from 'cesium';
import {
  classifyFeatureType,
  featureExtentDegrees,
  seafloorProminence,
} from './classification.js';
import {
  createSeafloorOverlayEntry,
  minorFeaturesEligible,
  seafloorImportance,
  seafloorLabel,
  seafloorLabelPriority,
  selectSeafloorLabelWinners,
} from './overlay.js';
import {
  PLATE_LINE_WIDTH,
  SEAFLOOR_ANCHOR_PIXEL_SIZE,
  SEAFLOOR_LINE_WIDTH,
  SEAFLOOR_OUTLINE_WIDTH,
  SEAFLOOR_NAMED_ANCHORS_ONLY_HEIGHT_M,
} from './policy.js';

const scratchCartographic = new Cesium.Cartographic();

/** Flat [lon, lat, lon, lat, ...] for Cartesian3.fromDegreesArray. */
function flattenPath(path) {
  const flat = [];
  for (const vertex of path) flat.push(vertex[0], vertex[1]);
  return flat;
}

export function createRendering({ state, selectEntityContext }) {
  /** Keyboard/assistive activation of a label: the click path, no flight. */
  function activateRecord(record) {
    if (!state._enabled || !record?.entity) return false;
    selectEntityContext?.(record.entity);
    state._viewer?.scene?.requestRender?.();
    return true;
  }

  function resetPublishSignature() {
    state._lastPublishedIds.length = 0;
    state._lastPublishedPriorities.length = 0;
    state._lastPublishedCount = -1;
  }

  /**
   * Remove both data sources from the viewer and forget the built entities.
   * Hiding is not enough: DataSourceDisplay still walks every visualizer of a
   * hidden source each frame, and 5,400 hidden points plus 3,000 hidden
   * ground lines keep costing CPU after the user toggled the layer off. The
   * parsed bundles stay cached, so the next enable rebuilds without a fetch.
   */
  function releaseDataSources(viewer) {
    const sources = [state._featureDataSource, state._plateDataSource];
    state._featureDataSource = null;
    state._plateDataSource = null;
    state._records = [];
    state._plateRecords = [];
    state._pickByEntity = new WeakMap();
    state._labelCount = 0;
    state._publishScratch.length = 0;
    state._loaded = false;
    state._sweepGate.reset();
    for (const source of sources) {
      if (!source) continue;
      try {
        viewer?.dataSources?.remove(source, true);
      } catch {
        /* collection gone */
      }
    }
  }

  function updateVisibility() {
    if (state._featureDataSource)
      state._featureDataSource.show = state._enabled;
    if (state._plateDataSource)
      state._plateDataSource.show =
        state._enabled && state._params.plates === true;
  }

  /** Lines always draw; polygon outlines only for the major kinds. */
  function pathsToDraw(feature, kind) {
    const paths = Array.isArray(feature.c) ? feature.c : [];
    if (feature.g === 'l') return paths;
    if (feature.g === 'y' && kind === 'major') return paths;
    return [];
  }

  function addPathEntity(dataSource, id, path, material, width) {
    if (!Array.isArray(path) || path.length < 2) return null;
    return dataSource.entities.add({
      id,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flattenPath(path)),
        width,
        material,
        clampToGround: true,
        classificationType: state._classificationType,
      },
    });
  }

  /**
   * Build one feature: an anchor point (the click and label target) plus,
   * for lines and major polygons, its ground paths. No stems: the sea
   * surface is flat, so the label host places text straight above the dot.
   * @param {object} feature Bundle record { n, t, k, r, g, a, c }.
   * @param {number} index Position in the bundle; the stable entity id.
   * @returns {object|null} The record, or null when the feature is unusable.
   */
  function addFeature(feature, index) {
    const dataSource = state._featureDataSource;
    const lon = Number(feature?.a?.[0]);
    const lat = Number(feature?.a?.[1]);
    if (!dataSource || !Number.isFinite(lon) || !Number.isFinite(lat))
      return null;
    const kind = feature.k === 'major' ? 'major' : 'minor';
    const { family } = classifyFeatureType(feature.t);
    const palette = state.palette;
    const anchor = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const id = `seafloor-${index}`;
    const entity = dataSource.entities.add({
      id,
      position: anchor,
      point: {
        pixelSize: SEAFLOOR_ANCHOR_PIXEL_SIZE[kind],
        color: palette.anchors[family][kind],
        outlineColor: palette.anchorOutline,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const material =
      feature.g === 'y' ? palette.outlines[family] : palette.lines[family];
    const width =
      feature.g === 'y' ? SEAFLOOR_OUTLINE_WIDTH : SEAFLOOR_LINE_WIDTH;
    const pathEntities = pathsToDraw(feature, kind)
      .map((path, j) =>
        addPathEntity(dataSource, `${id}-path-${j}`, path, material, width),
      )
      .filter(Boolean);
    const rank = Number.isFinite(feature.r) ? feature.r : 30;
    const extentDeg = featureExtentDegrees(feature.c);
    const record = {
      id,
      index,
      entity,
      pathEntities,
      anchor,
      lon,
      lat,
      name: String(feature.n || ''),
      type: String(feature.t || ''),
      kind,
      rank,
      extentDeg,
      prominence: seafloorProminence(rank, extentDeg),
      family,
      geometry: feature.g,
      label: '',
      visible: false,
      distanceM: Infinity,
      entry: null,
    };
    record.label = seafloorLabel(record);
    record.entry = createSeafloorOverlayEntry(record, {
      activate: () => activateRecord(record),
    });
    state._records.push(record);
    return record;
  }

  /**
   * One ground polyline per merged PB2002 segment, coloured by class.
   * @param {{c:string,p:string,v:number[][]}} segment
   * @param {number} index
   */
  function addPlateSegment(segment, index) {
    const dataSource = state._plateDataSource;
    const material = state.palette.plates[segment?.c];
    if (!dataSource || !material) return null;
    const entity = addPathEntity(
      dataSource,
      `plate-${index}`,
      segment.v,
      material,
      PLATE_LINE_WIDTH,
    );
    if (!entity) return null;
    const record = {
      id: entity.id,
      entity,
      code: segment.c,
      plates: segment.p,
    };
    state._plateRecords.push(record);
    return record;
  }

  /**
   * Re-classify every ground line for the active surface. One batched
   * ground-primitive rebuild per stack switch, never per frame.
   * @param {Cesium.ClassificationType} next
   */
  function applyClassification(next) {
    if (next === undefined || next === state._classificationType) return;
    state._classificationType = next;
    for (const source of [state._featureDataSource, state._plateDataSource]) {
      if (!source) continue;
      for (const entity of source.entities.values) {
        if (entity.polyline) entity.polyline.classificationType = next;
      }
    }
    state._viewer?.scene?.requestRender?.();
  }

  function cameraHeight(cameraPos) {
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(
      cameraPos,
      scratchCartographic,
    );
    return carto ? carto.height : 0;
  }

  /** Horizon cull, distances and the minor gate, for every anchor. */
  function sweepAnchors(cameraPos, cameraHeightM) {
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      cameraPos,
    );
    const minorShown = minorFeaturesEligible({
      cameraHeightM,
      names: state._params.names,
    });
    for (const record of state._records) {
      record.visible =
        (record.kind === 'major' || minorShown) &&
        occluder.isPointVisible(record.anchor);
      record.distanceM = Cesium.Cartesian3.distance(cameraPos, record.anchor);
    }
  }

  /**
   * Show the anchors the sweep admitted; at global framing only those whose
   * names are on screen, so no dot is left unexplained. A stamp marks the
   * winners, so the pass allocates nothing per sweep.
   */
  function applyAnchorVisibility(winners, cameraHeightM) {
    const namedOnly = cameraHeightM >= SEAFLOOR_NAMED_ANCHORS_ONLY_HEIGHT_M;
    const stamp = ++state._anchorStamp;
    if (namedOnly) for (const record of winners) record.namedStamp = stamp;
    for (const record of state._records) {
      const shown =
        record.visible && (!namedOnly || record.namedStamp === stamp);
      if (record.entity.show !== shown) record.entity.show = shown;
    }
  }

  /** Publish the winners only when the cohort or its priorities changed. */
  function publishWinners(winners) {
    let changed = winners.length !== state._lastPublishedCount;
    for (let i = 0; i < winners.length; i++) {
      const record = winners[i];
      const priority = seafloorLabelPriority(
        seafloorImportance(record),
        record.distanceM,
      );
      record.entry.priority = priority;
      state._publishScratch[i] = record.entry;
      if (
        !changed &&
        (state._lastPublishedIds[i] !== record.entry.id ||
          state._lastPublishedPriorities[i] !== priority)
      )
        changed = true;
    }
    state._publishScratch.length = winners.length;
    state._labelCount = winners.length;
    if (!changed) return;
    state._overlayPublisher.publish(state._publishScratch);
    state._lastPublishedCount = winners.length;
    for (let i = 0; i < winners.length; i++) {
      state._lastPublishedIds[i] = state._publishScratch[i].id;
      state._lastPublishedPriorities[i] = state._publishScratch[i].priority;
    }
    state._lastPublishedIds.length = winners.length;
    state._lastPublishedPriorities.length = winners.length;
  }

  /** The sweep: runs on the gate's cadence, never per frame. */
  function updateVisibilitySweep() {
    if (!state._enabled || !state._viewer?.camera) return;
    const cameraPos = state._viewer.camera.positionWC;
    if (!cameraPos) return;
    const cameraHeightM = cameraHeight(cameraPos);
    state._cameraHeightM = cameraHeightM;
    sweepAnchors(cameraPos, cameraHeightM);
    const winners = selectSeafloorLabelWinners(state._records, {
      cameraHeightM,
      names: state._params.names,
    });
    applyAnchorVisibility(winners, cameraHeightM);
    publishWinners(winners);
  }

  return {
    resetPublishSignature,
    releaseDataSources,
    updateVisibility,
    addFeature,
    addPlateSegment,
    applyClassification,
    updateVisibilitySweep,
  };
}
