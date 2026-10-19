/**
 * @module dhuan/storyStrip
 *
 * The strip under the wordmark: how many fires NASA saw over the stubble belt
 * today, how bad Delhi's air is right now, when those numbers were taken, and
 * one button that plays the story scene. Every figure is read from the layer
 * stats the Layers panel already shows; nothing here fetches.
 *
 * A stat whose layer is off becomes the switch that turns it on, so the strip
 * is also the fastest way into the data. A stat whose layer needs a key says
 * so in words rather than showing a dash that reads as "no fires".
 */
import { t, tn, msg } from '../i18n/index.js';
import { EDITION } from '../edition.js';

/** The data manager publishes on every change; this is the floor between repaints. */
const REFRESH_MS = 30_000;
const FIRE_LAYER_ID = 'local-firms';
const AIR_LAYER_ID = 'air-quality';

const PLAY_LABEL = msg('Play Smog Season Live');

/**
 * Dark ink on every band but the darkest (Severe maroon), so the badge word
 * clears 4.5:1 on each published CPCB colour: white on the Very Poor red only
 * reaches 4.0:1, dark ink reaches 4.8:1.
 * @param {string} hex - `#rrggbb`
 * @returns {string}
 */
export function inkFor(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return '#ffffff';
  const value = parseInt(match[1], 16);
  const channel = (shift) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.18 ? '#101418' : '#ffffff';
}
const STOP_LABEL = msg('Stop the scene');

/**
 * Mount the strip into `#dhuan-story`.
 * @param {object} options
 * @param {HTMLElement} [options.root]
 * @param {object} options.dataManager - Layer manager (`getAll`, `subscribe`, `setEnabled`).
 * @param {object} [options.sceneDirector] - Director with `startScene`, `stopScene`, `subscribe`.
 * @param {object} [options.edition]
 * @param {Document} [options.documentRef]
 * @returns {{refresh: Function, destroy: Function}|null}
 */
export function initStoryStrip({
  root = globalThis.document?.getElementById?.('dhuan-story'),
  dataManager,
  sceneDirector = null,
  edition = EDITION,
  documentRef = globalThis.document,
} = {}) {
  if (!root || !dataManager || typeof dataManager.getAll !== 'function')
    return null;
  const story = edition.story || {};
  const fireRegionId = story.fireRegionId || edition.hudFireRegionId;
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const make = (tag, className, parent) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    parent?.appendChild(node);
    return node;
  };
  const icon = (name, parent) => {
    const node = make('span', 'material-symbols-outlined story-icon', parent);
    node.setAttribute('aria-hidden', 'true');
    node.textContent = name;
    return node;
  };

  root.textContent = '';
  const list = make('dl', 'story-stats', root);
  const buildStat = (key, iconName) => {
    const item = make('div', `story-stat story-stat-${key}`, list);
    item.dataset.stat = key;
    icon(iconName, item);
    const body = make('div', 'story-body', item);
    // <dt> before <dd> for the reader; the sheet shows the number first.
    const label = make('dt', 'story-label', body);
    const value = make('dd', 'story-value', body);
    return { item, value, label };
  };
  const fires = buildStat('fires', 'local_fire_department');
  const air = buildStat('air', 'air');
  const meta = make('p', 'story-meta', root);
  meta.setAttribute('role', 'status');
  const play = make('button', 'story-play', root);
  play.type = 'button';
  const playIcon = icon('play_arrow', play);
  const playText = make('span', 'story-play-label', play);

  let destroyed = false;
  let unsubscribeData = null;
  let unsubscribeScene = null;
  let timer = null;
  let running = false;

  /** A dash or an ellipsis in the value slot is decoration, not a reading. */
  const placeholder = (stat, glyph) => {
    stat.value.textContent = '';
    const mark = make('span', 'story-placeholder', stat.value);
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = glyph;
  };

  /** Live text that only changes when its words do, so nothing re-announces. */
  const setMeta = (text) => {
    if (meta.textContent !== text) meta.textContent = text;
  };

  /** Keyboard focus must survive a repaint that removes the focused control. */
  const restoreFocus = (stat) => {
    const target = play.hidden ? stat.item : play;
    if (target === stat.item) stat.item.tabIndex = -1;
    target.focus?.();
  };

  const layerById = (id) =>
    dataManager.getAll().find((layer) => layer.id === id) || null;

  /** Replace a stat's label with a switch that turns its layer on. */
  const offerEnable = (stat, layerId, text) => {
    stat.label.textContent = '';
    const button = make('button', 'story-enable', stat.label);
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      // aria-disabled, not `disabled`: a native disabled control evicts the
      // keyboard focus that is about to need a new home.
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-busy', 'true');
      const hadFocus = documentRef.activeElement === button;
      try {
        await dataManager.setEnabled(layerId, true, { origin: 'user' });
      } catch {
        /* the layer row reports its own failure */
      } finally {
        if (!destroyed) {
          refresh();
          if (hadFocus && !button.isConnected) restoreFocus(stat);
          else {
            button.removeAttribute('aria-disabled');
            button.removeAttribute('aria-busy');
          }
        }
      }
    });
  };

  const paintFires = () => {
    const layer = layerById(FIRE_LAYER_ID);
    const stats = layer?.stats || {};
    const region = (stats.regions || []).find(
      (entry) => entry.id === fireRegionId,
    );
    fires.item.dataset.state = '';
    if (!layer) {
      fires.item.hidden = true;
      return null;
    }
    fires.item.hidden = false;
    if (!layer.enabled) {
      placeholder(fires, '—');
      fires.item.dataset.state = 'off';
      offerEnable(fires, FIRE_LAYER_ID, t('Turn on active fires'));
      return null;
    }
    if (stats.keyRequired) {
      placeholder(fires, '—');
      fires.item.dataset.state = 'key';
      fires.label.textContent = t('Active fires need a NASA FIRMS key');
      return null;
    }
    if (!region || !stats.lastUpdate) {
      placeholder(fires, '…');
      fires.item.dataset.state = 'loading';
      fires.label.textContent = t('Counting fires over Punjab and Haryana');
      return null;
    }
    fires.value.textContent = region.count.toLocaleString();
    fires.label.textContent = tn(
      region.count,
      'active fire · Punjab + Haryana · last 24 h',
      'active fires · Punjab + Haryana · last 24 h',
    );
    return stats.lastUpdate;
  };

  const paintAir = () => {
    const layer = layerById(AIR_LAYER_ID);
    const stats = layer?.stats || {};
    const summary = stats.story;
    air.item.dataset.state = '';
    air.item.style.removeProperty('--band');
    air.item.style.removeProperty('--band-ink');
    if (!layer) {
      air.item.hidden = true;
      return null;
    }
    air.item.hidden = false;
    if (!layer.enabled) {
      placeholder(air, '—');
      air.item.dataset.state = 'off';
      offerEnable(air, AIR_LAYER_ID, t('Turn on air quality'));
      return null;
    }
    if (stats.keyRequired) {
      placeholder(air, '—');
      air.item.dataset.state = 'key';
      air.label.textContent = t('Air quality needs a data.gov.in key');
      return null;
    }
    if (!summary || !stats.lastUpdate) {
      placeholder(air, '…');
      air.item.dataset.state = 'loading';
      air.label.textContent = t('Reading CPCB stations');
      return null;
    }
    const regionLabel = t(summary.label);
    if (!summary.worst) {
      placeholder(air, '—');
      air.item.dataset.state = 'empty';
      air.label.textContent = t('{region} · no station reporting', {
        region: regionLabel,
      });
      return stats.observedAt || stats.lastUpdate;
    }
    const { worst } = summary;
    air.value.textContent = '';
    const number = make('span', 'story-number', air.value);
    number.textContent = worst.label || String(worst.value);
    const badge = make('span', 'story-badge', air.value);
    badge.textContent = worst.bandLabel ? t(worst.bandLabel) : '';
    if (worst.color) {
      air.item.style.setProperty('--band', worst.color);
      air.item.style.setProperty('--band-ink', inkFor(worst.color));
    }
    const alert = summary.alertCount
      ? ' · ' +
        tn(
          summary.alertCount,
          '{count} of {total} stations in the top two bands',
          '{count} of {total} stations in the top two bands',
          { total: summary.count },
        )
      : '';
    air.label.textContent =
      t('{region} · worst station {station}', {
        region: regionLabel,
        station: worst.name,
      }) + alert;
    return stats.observedAt || stats.lastUpdate;
  };

  const paintMeta = (times) => {
    const stamps = times.filter((value) => Number.isFinite(value) && value > 0);
    if (!stamps.length) {
      setMeta(t('Sources: NASA FIRMS · CPCB via data.gov.in'));
      return;
    }
    const newest = Math.max(...stamps);
    setMeta(
      t('Updated {time} IST · NASA FIRMS · CPCB', {
        time: timeFormat.format(new Date(newest)),
      }),
    );
  };

  const paintPlay = () => {
    const available = Boolean(sceneDirector && story.sceneId);
    play.hidden = !available;
    if (!available) return;
    playIcon.textContent = running ? 'close' : 'play_arrow';
    playText.textContent = t(running ? STOP_LABEL : PLAY_LABEL);
    play.dataset.running = String(running);
  };

  const refresh = () => {
    if (destroyed) return;
    const fireTime = paintFires();
    const airTime = paintAir();
    paintMeta([fireTime, airTime]);
    paintPlay();
  };

  play.addEventListener('click', async () => {
    if (!sceneDirector || play.getAttribute('aria-disabled') === 'true') return;
    play.setAttribute('aria-disabled', 'true');
    try {
      if (running) {
        await sceneDirector.stopScene?.(msg('Stopped'));
      } else {
        const outcome = await sceneDirector.startScene(story.sceneId, {
          single: true,
        });
        if (outcome && outcome.started === false && !destroyed) {
          setMeta(
            t(
              'The story scene is missing. Import scenes/smog-season-live.json from the Scenes panel.',
            ),
          );
        }
      }
    } catch {
      /* the scene panel reports its own failure */
    } finally {
      if (!destroyed) {
        play.removeAttribute('aria-disabled');
        paintPlay();
      }
    }
  });

  if (typeof dataManager.subscribe === 'function')
    unsubscribeData = dataManager.subscribe(() => refresh());
  if (typeof sceneDirector?.subscribe === 'function')
    unsubscribeScene = sceneDirector.subscribe((notification) => {
      const next = Boolean(notification?.state?.running);
      if (next !== running) {
        running = next;
        paintPlay();
      }
    });
  timer = globalThis.setInterval?.(refresh, REFRESH_MS);
  root.hidden = false;
  refresh();

  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeData?.();
      unsubscribeScene?.();
      if (timer) globalThis.clearInterval?.(timer);
      root.hidden = true;
      root.textContent = '';
    },
  };
}

/** Test seam: the layer ids and the clock cadence the strip relies on. */
export const STORY_STRIP_CONTRACT = Object.freeze({
  FIRE_LAYER_ID,
  AIR_LAYER_ID,
  REFRESH_MS,
});
