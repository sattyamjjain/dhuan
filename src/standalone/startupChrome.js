import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initStoryStrip } from '../dhuan/storyStrip.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initKeySetup,
    initializeStory: initStoryStrip,
    ...options,
  });
}
