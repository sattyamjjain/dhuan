import * as Cesium from 'cesium';
import { msg, t } from '../../i18n/index.js';
import { SEAFLOOR_LAYER_ID } from './policy.js';

const FEATURE_SOURCE_NAME = 'GEBCO Sea floor features';
const PLATE_SOURCE_NAME = 'PB2002 Plate boundaries';

function validateBundle(bundle) {
  if (
    !Array.isArray(bundle?.features?.features) ||
    !Array.isArray(bundle?.plates?.segments)
  ) {
    throw new TypeError(
      'A sea floor source must return the gazetteer features and the plate segments bundles',
    );
  }
  return bundle;
}

export function createIngestion({
  state,
  parts,
  source,
  registerEntityContext,
}) {
  function registerContext(record, dataSource) {
    if (typeof registerEntityContext !== 'function') return;
    registerEntityContext(record.entity, {
      id: `${SEAFLOOR_LAYER_ID}:${record.index}`,
      layerId: SEAFLOOR_LAYER_ID,
      layerName: msg('Sea floor features'),
      source: source.label,
      dataSource,
      label: record.label,
      properties: {
        name: record.name,
        type: record.type,
        kind: record.kind,
        family: record.family,
        geometry: record.geometry,
      },
      latitude: record.lat,
      longitude: record.lon,
    });
  }

  /** Build every entity from the cached bundle into the accepted sources. */
  function populate(bundle, featureSource) {
    state._pickByEntity = new WeakMap();
    state._records = [];
    state._plateRecords = [];
    const familyCounts = {};
    bundle.features.features.forEach((feature, index) => {
      const record = parts.rendering.addFeature(feature, index);
      if (!record) return;
      familyCounts[record.family] = (familyCounts[record.family] || 0) + 1;
      parts.interaction.registerPickEntity(record.entity, record);
      for (const entity of record.pathEntities)
        parts.interaction.registerPickEntity(entity, record);
      registerContext(record, featureSource);
    });
    const plateClassCounts = {};
    bundle.plates.segments.forEach((segment, index) => {
      const record = parts.rendering.addPlateSegment(segment, index);
      if (!record) return;
      plateClassCounts[record.code] = (plateClassCounts[record.code] || 0) + 1;
    });
    state._familyCounts = familyCounts;
    state._plateClassCounts = plateClassCounts;
    state._count = state._records.length;
    state._plateCount = state._plateRecords.length;
  }

  async function load(viewer) {
    if (state._loading || state._loaded) return;

    state._loading = true;
    state._error = null;
    state._loadingLabel = t('loading...');
    // Ownership token (the cables pattern): a disable/abort followed by a
    // fresh enable starts a NEWER load while this one is still settling. The
    // stale load must bail after every await and never touch shared state
    // or the viewer it no longer owns.
    const generation = ++state._loadGeneration;
    const abort = new AbortController();
    state._abort = abort;
    const owns = () =>
      generation === state._loadGeneration && !abort.signal.aborted;

    try {
      let bundle = state._cachedBundle;
      if (!bundle) {
        bundle = validateBundle(await source.fetch(abort.signal));
        if (!owns()) return;
        state._cachedBundle = bundle;
      }

      const featureSource = new Cesium.CustomDataSource(FEATURE_SOURCE_NAME);
      const plateSource = new Cesium.CustomDataSource(PLATE_SOURCE_NAME);
      const addedSources = [featureSource, plateSource];

      // dataSources.add() settles on a deferred tick, so a disable racing
      // this window finds nothing to remove. Await every add (allSettled so
      // a partial failure cannot leave an unawaited add materializing
      // later), then re-check ownership and compensate by removing exactly
      // the sources THIS generation added.
      const addResults = await Promise.allSettled(
        addedSources.map((dataSource) => viewer.dataSources.add(dataSource)),
      );
      const rejectedAdd = addResults.find(
        (result) => result.status === 'rejected',
      );
      if (!owns() || rejectedAdd) {
        for (const dataSource of addedSources) {
          try {
            viewer.dataSources.remove(dataSource, true);
          } catch {
            /* collection gone */
          }
        }
        if (owns() && rejectedAdd) throw rejectedAdd.reason;
        return;
      }

      // Await-free commit: the viewer accepted both sources and this load
      // still owns the lifecycle.
      state._featureDataSource = featureSource;
      state._plateDataSource = plateSource;
      populate(bundle, featureSource);
      state._loaded = true;
      state._lastUpdate = Date.now();
      state._loadingLabel = '';
      parts.rendering.updateVisibility();
      parts.rendering.resetPublishSignature();
      state._sweepGate.markDirty();
      viewer.scene?.requestRender?.();
      parts.notifyRowControls?.();
    } catch (error) {
      // A stale or aborted load reports nothing: its failure belongs to a
      // lifecycle the user already left.
      if (owns() && error?.name !== 'AbortError') {
        state._error = error?.message || msg('GEBCO load failed');
        console.warn(`[Data:${SEAFLOOR_LAYER_ID}]`, state._error, error);
        parts.notifyRowControls?.();
      }
    } finally {
      // Only the OWNING load may clear the shared lifecycle.
      if (generation === state._loadGeneration) {
        state._loading = false;
        if (state._abort === abort) state._abort = null;
      }
    }
  }
  return { load };
}
