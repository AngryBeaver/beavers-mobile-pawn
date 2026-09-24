import { MODULE_ID } from "../core/protocol.js";

/**
 * Keep the phone's screen on while phone mode is open, like a video player does. Uses the Screen Wake Lock API,
 * which browsers only offer over HTTPS: on plain HTTP (or an old browser) the normal screen timeout applies.
 *
 * The browser drops the lock whenever the page is hidden (app switch, screen turned off by hand), so it is asked
 * for again when the page is visible again. Some browsers only grant it after a user gesture, so any touch on the
 * page retries too; while a lock is held that is a no-op.
 */
export function keepScreenOn() {
  const wakeLock = navigator.wakeLock;
  if (!wakeLock) {
    console.info(`${MODULE_ID} | screen wake lock unavailable (needs https and a current browser), the screen may turn off`);
    return;
  }
  let sentinel: WakeLockSentinel | undefined;
  let requesting = false;
  const request = async () => {
    if (requesting || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
    requesting = true;
    try {
      sentinel = await wakeLock.request("screen");
    } catch (e) {
      // NotAllowedError without a gesture yet (retried on the next touch), or refused by the browser / battery saver
      console.debug(`${MODULE_ID} | screen wake lock refused`, e);
    } finally {
      requesting = false;
    }
  };
  document.addEventListener("visibilitychange", () => void request());
  document.addEventListener("pointerdown", () => void request(), { capture: true, passive: true });
  void request();
}
