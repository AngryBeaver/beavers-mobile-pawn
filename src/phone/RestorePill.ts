import { setExitedPhone } from "../settings.js";

/** After leaving phone mode: a small button in the normal Foundry UI that goes back to it. */
export function showRestorePill() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bmp-restore";
  btn.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> ${game.i18n.localize("beaversMobilePawn.phone.restore")}`;
  btn.addEventListener("click", () => {
    setExitedPhone(false);
    location.reload();
  });
  document.body.appendChild(btn);
}
