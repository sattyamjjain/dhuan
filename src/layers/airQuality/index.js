import * as Cesium from 'cesium';
import { msg, t, tn } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import {
  AIR_QUALITY_OVERLAY_SOURCE_ID,
  AIR_QUALITY_OVERLAY_COHORT_LIMIT,
  AIR_QUALITY_OVERLAY_COLLISION_CAPACITY,
  airQualityProvider,
  createAirQualityOverlayEntry,
  mapAnalystRecord,
  newestObservation,
  providerBandRanges,
  providerBands,
  readingsAreStale,
  readingsInView,
  selectAirQualityOverlayCohort,
  summarizeAirQualityRegion,
} from './model.js';
export * from './model.js';
export {
  createAirQualitySource,
  createCpcbAirQualitySource,
  createEcccAirQualitySource,
  resolveAirQualityProviderId,
} from './source.js';

/** Station markers are a point reading, not an extent; a provider may size its own. */
const STATION_MARKER_RADIUS_M = 6_000;
/**
 * A light ring under each marker, so a dark band (Severe, Very Poor) still
 * reads on dark terrain without relying on hue. Ground geometry draws no
 * outline, so the ring is a slightly larger fill beneath the colour.
 */
const STATION_RING_SCALE = 1.27;
const STATION_RING_COLOR = 'rgba(255, 255, 255, 0.55)';
/** Readings listed in the readout card. */
const READOUT_LIMIT = 5;

/**
 * Own one air-quality display, its refresh lifecycle, and its readout card.
 *
 * The source names its provider (`providerId`); the layer takes its scale,
 * legend, coverage line and stale rule from that descriptor, so a second
 * network is a second source, not a second layer. A source that names none
 * is ECCC's, the first registered provider.
 */
export function createAirQualityLayer({
  source,
  overlayHost,
  storyRegion = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Air quality requires a snapshot source');
  if (!overlayHost) throw new TypeError('Air quality requires an overlay host');
  const provider = airQualityProvider(source.providerId);
  const markerRadiusM = provider.markerRadiusM || STATION_MARKER_RADIUS_M;
  const ringRadiusM = markerRadiusM * STATION_RING_SCALE;
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _readings = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _keyRequired = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  /** The camera's lon/lat rectangle in degrees, or null when unresolvable. */
  const viewRectangle = () => {
    const rectangle = _viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const toDeg = Cesium.Math.toDegrees;
    return {
      west: toDeg(rectangle.west),
      south: toDeg(rectangle.south),
      east: toDeg(rectangle.east),
      north: toDeg(rectangle.north),
    };
  };

  const layer = {
    id: 'air-quality',
    name: 'Air quality',
    icon: '◍',
    source: provider.sourceLabel,
    // The provider key the proxy needs, if any (null for keyless ECCC). The
    // panel names the variable from the key registry while stats.keyRequired.
    requiresKeyId: provider.requiresKeyId,
    updateInterval: 1_200_000,

    init(viewer) {
      if (_viewer) throw new Error('Air quality layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('air-quality');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _readings = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
      _enabled = false;
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, true);
      notify();
    },

    disable() {
      // Abort in flight: a response arriving after disable must not redraw.
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(AIR_QUALITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        // A superseded or aborted request must not touch the scene, and neither
        // must one that lands after the layer was switched off.
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // A keyed provider without its key is a step the operator can take,
        // not a fault: clear the display and let the row say KEY REQUIRED.
        if (!Array.isArray(snapshot) && snapshot?.keyRequired === true) {
          _keyRequired = true;
          _readings = [];
          this._render();
          _count = 0;
          _lastUpdate = Date.now();
          _lastError = null;
          notify();
          return false;
        }
        _keyRequired = false;
        _readings = snapshot;
        this._render();
        _count = _readings.length;
        _lastUpdate = Date.now();
        _lastError = null;
        notify();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('Air quality request failed');
        console.warn('[Data:AirQuality] Refresh failed:', _lastError);
        notify();
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    /** Rebuild entities and overlay labels from the current readings. */
    _render() {
      if (!_dataSource) return;
      _dataSource.entities.removeAll();
      const overlayEntries = [];
      for (const reading of _readings) {
        const position = Cesium.Cartesian3.fromDegrees(
          reading.lon,
          reading.lat,
        );
        const color = Cesium.Color.fromCssColorString(reading.color);
        _dataSource.entities.add(
          new Cesium.Entity({
            id: `air-quality:${reading.id}:ring`,
            position,
            ellipse: {
              semiMajorAxis: ringRadiusM,
              semiMinorAxis: ringRadiusM,
              material: new Cesium.ColorMaterialProperty(
                Cesium.Color.fromCssColorString(STATION_RING_COLOR),
              ),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              zIndex: 0,
            },
          }),
        );
        _dataSource.entities.add(
          new Cesium.Entity({
            id: `air-quality:${reading.id}`,
            position,
            ellipse: {
              // Static axes, as in the earthquake layer: a per-frame axis
              // re-tessellates the clamped ground primitive every frame.
              semiMajorAxis: markerRadiusM,
              semiMinorAxis: markerRadiusM,
              material: new Cesium.ColorMaterialProperty(color.withAlpha(0.45)),
              outline: true,
              outlineColor: color.withAlpha(0.9),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              zIndex: 1,
            },
            properties: {
              provider: reading.provider,
              scale: reading.scale,
              value: reading.value,
              band: reading.band,
              name: reading.name,
              zone: reading.zone,
              city: reading.city ?? null,
              dominant: reading.dominant ?? null,
              risk: reading.risk,
              observedMs: reading.observedMs,
              note: reading.note,
              lat: reading.lat,
              lon: reading.lon,
            },
          }),
        );
        overlayEntries.push(
          createAirQualityOverlayEntry({
            id: reading.id,
            position,
            title: `${reading.name} ${reading.label}`,
            accent: reading.color,
            value: reading.value,
          }),
        );
      }
      if (_enabled) {
        overlayHost.setEntries(
          AIR_QUALITY_OVERLAY_SOURCE_ID,
          selectAirQualityOverlayCohort(overlayEntries),
          {
            cohortLimit: AIR_QUALITY_OVERLAY_COHORT_LIMIT,
            collisionCapacity: AIR_QUALITY_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(AIR_QUALITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIR_QUALITY_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _readings = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
      rowControlsListener = null;
    },

    /**
     * Readout descriptor for the Weather panel: the provider's band legend,
     * and the worst readings currently in view.
     *
     * `readout: true` renders the toggle and source line only; the card owns
     * the rest. Coverage is stated plainly because this layer is not global.
     */
    getRowControls() {
      const ranges = providerBandRanges(provider.id);
      const inView = readingsInView(_readings, viewRectangle(), READOUT_LIMIT);
      const newest = _readings.reduce(
        (max, reading) => Math.max(max, reading.observedMs || 0),
        0,
      );
      // Readings and errors stay English data (analyst records, stats); the
      // card translates them as the Layers panel row does. A provider's own
      // error text has no catalog entry and shows as it came.
      return {
        readout: true,
        summary: {
          label: t(provider.label),
          coverage: t(provider.coverage),
          validTime: newest ? new Date(newest).toISOString() : undefined,
          detail: `${provider.network} · ${provider.scale}`,
          status: _keyRequired
            ? t('KEY REQUIRED')
            : _lastError
              ? translateFeedError(_lastError)
              : _count === 0
                ? _lastUpdate === null
                  ? t('No readings available')
                  : t('No current readings')
                : tn(
                    _count,
                    '{count} station reporting',
                    '{count} stations reporting',
                  ),
          units: provider.scale,
        },
        // The legend keeps the published swatch colour; the map may lighten it.
        legend: providerBands(provider.id).map((band) => ({
          color: band.color,
          label: provider.legendRanges
            ? t('{band} ({range})', {
                band: t(band.label),
                range: ranges.get(band.id),
              })
            : t(band.label),
        })),
        legendCategorical: true,
        list: {
          ariaLabel: t('Highest air-quality readings in view'),
          items: inView.map((reading, index) => ({
            id: reading.id,
            ordinal: index + 1,
            lead: `${reading.scale} ${reading.label}`,
            // The band in words beats the risk sentence on a one-line row, and
            // the dominant pollutant (CPCB) says why a station reads as it does.
            text: [
              reading.name,
              reading.bandLabel ? t(reading.bandLabel) : t(reading.risk),
              reading.dominant,
            ]
              .filter(Boolean)
              .join(' · '),
            accent: reading.color,
          })),
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot readings as JSON-safe records for the analyst query engine.
     * @param {number} [maxCount=500]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_readings.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _readings
        .slice(0, limit)
        .map((reading, index) => mapAnalystRecord(reading, index));
    },

    getStats() {
      // `lastUpdate` is when a response was received; `observedAt` is when the
      // network actually measured. Freshness is judged on the latter, so a feed
      // that keeps answering with hours-old observations reports STALE rather
      // than being narrated as live by the HUD and voice provenance envelope.
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        // The machine-readable half of the keyless state (FIRMS's contract):
        // without it "no key configured" is indistinguishable from a fault.
        keyRequired: _keyRequired,
        error: _keyRequired ? t('KEY REQUIRED') : _lastError,
        observedAt: newestObservation(_readings),
        // The edition's city read (worst station, stations in the top two
        // bands) for the story strip. Null when no region is configured.
        story: storyRegion
          ? summarizeAirQualityRegion(_readings, storyRegion, provider.id)
          : null,
        // Only a completed refresh can be stale; before one there is no feed.
        // A missing key is a step to take, not a stale feed.
        stale:
          _lastUpdate !== null &&
          !_keyRequired &&
          readingsAreStale(_readings, Date.now(), provider.staleAfterMs),
      };
    },
  };
  return layer;
}
