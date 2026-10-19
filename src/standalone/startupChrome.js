import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initStoryStrip } from '../dhuan/storyStrip.js';
import { EDITION } from '../edition.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: (settings) =>
      initKeySetup({ ...settings, keyIds: EDITION.keyIds }),
    initializeStory: initStoryStrip,
    ...options,
  });
}
