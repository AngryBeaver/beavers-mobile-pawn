import { MODULE_ID } from "./core/protocol.js";
import { exposeApi } from "./extensions/doorExtensions.js";
import { registerSolidDoors } from "./extensions/solidDoors.js";
import { PhoneApp } from "./phone/PhoneApp.js";
import { showRestorePill } from "./phone/RestorePill.js";
import { registerAssignmentsMenu } from "./settings/AssignmentsApp.js";
import {
  getSetting,
  hasExitedPhone,
  HOOK_ASSIGNMENTS,
  registerSettings,
  releaseCanvas,
  resolveRole,
  S,
} from "./settings.js";
import { TableOverlay } from "./table/TableOverlay.js";

Hooks.once("init", () => {
  registerSettings();
  registerAssignmentsMenu();
  exposeApi();
});

// After every module's init, so their APIs exist. Table and phone both need the door extensions.
Hooks.once("setup", () => registerSolidDoors());

Hooks.once("ready", () => {
  const role = resolveRole();
  console.log(`${MODULE_ID} | role: ${role}`);
  let phone: PhoneApp | undefined;

  // Phone mode left the canvas disabled (role changed, browser or tab was killed before it could clean up):
  // this device is not a phone any more, give the canvas back.
  if (role !== "phone" && game.settings.get("core", "noCanvas") && getSetting(S.CANVAS_FLIPPED)) {
    releaseCanvas().then(() => location.reload());
    return;
  }

  // The GM changed roles or characters: a new role needs a reload, new characters only a refresh of the phone.
  Hooks.on(HOOK_ASSIGNMENTS, () => {
    if (resolveRole() !== role) foundry.utils.debouncedReload();
    else phone?.refreshActors();
  });

  // GMs are never phones, so "back to phone" would only reload into the same page
  if (role === "off" && hasExitedPhone() && !game.user.isGM) showRestorePill();

  if (role === "table") {
    new TableOverlay().start();
  }

  if (role === "phone") {
    // The phone never needs the map. Foundry only reads its "no canvas" client setting at startup,
    // so the first time this browser becomes a phone we flip it once and reload.
    try {
      if (!game.settings.get("core", "noCanvas")) {
        document.body.textContent = game.i18n.localize("beaversMobilePawn.phone.reloading");
        Promise.all([
          game.settings.set(MODULE_ID, S.CANVAS_FLIPPED, true),
          game.settings.set("core", "noCanvas", true),
        ]).then(() => location.reload());
        return;
      }
      // "Disable Canvas" is shared by every world in this browser, so hand it back when this page goes away.
      // Reloading the phone therefore costs one extra reload, but no other game is left without a canvas.
      game.settings.set(MODULE_ID, S.CANVAS_FLIPPED, true);
      window.addEventListener("pagehide", () => void releaseCanvas());
    } catch (e) {
      console.warn(`${MODULE_ID} | could not disable the canvas, continuing with it loaded`, e);
    }
    phone = new PhoneApp();
    phone.start_();
  }
});
