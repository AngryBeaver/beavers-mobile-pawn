import { chooseActorIds, normalizeAssignments, type Assignments } from "./core/assignments.js";
import { MODULE_ID } from "./core/protocol.js";

export const S = {
  ROLE: "role",
  ASSIGNMENTS: "assignments",
  LAST_ACTOR: "lastActor",
  CANVAS_FLIPPED: "canvasFlipped",
  PAD_COLUMNS: "padColumns",
  MAX_STEPS: "maxSteps",
  STEP_DELAY: "stepDelay",
} as const;

export type Role = "phone" | "table" | "off";

/** Fired on every client when the GM saves the role / character assignments. */
export const HOOK_ASSIGNMENTS = `${MODULE_ID}.assignments`;

const EXIT_KEY = `${MODULE_ID}.exited`;

export function registerSettings() {
  game.settings.register(MODULE_ID, S.ROLE, {
    name: "beaversMobilePawn.settings.role.name",
    hint: "beaversMobilePawn.settings.role.hint",
    scope: "client",
    config: true,
    type: String,
    default: "auto",
    requiresReload: true,
    // a freshly picked role should apply, not be vetoed by an earlier exit from the phone
    onChange: () => setExitedPhone(false),
    choices: {
      auto: "beaversMobilePawn.settings.role.auto",
      phone: "beaversMobilePawn.settings.role.phone",
      table: "beaversMobilePawn.settings.role.table",
      off: "beaversMobilePawn.settings.role.off",
    },
  });
  game.settings.register(MODULE_ID, S.ASSIGNMENTS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => Hooks.callAll(HOOK_ASSIGNMENTS),
  });
  game.settings.register(MODULE_ID, S.LAST_ACTOR, { scope: "client", config: false, type: String, default: "" });
  // "Disable Canvas" is a browser-wide setting (every world, every user of this browser). This remembers that phone
  // mode switched it on, so it can be switched off again when phone mode ends.
  game.settings.register(MODULE_ID, S.CANVAS_FLIPPED, { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, S.PAD_COLUMNS, {
    name: "beaversMobilePawn.settings.padColumns.name",
    hint: "beaversMobilePawn.settings.padColumns.hint",
    scope: "client",
    config: true,
    type: Number,
    default: 9,
    range: { min: 5, max: 21, step: 2 },
  });
  game.settings.register(MODULE_ID, S.MAX_STEPS, {
    name: "beaversMobilePawn.settings.maxSteps.name",
    hint: "beaversMobilePawn.settings.maxSteps.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 40,
    range: { min: 5, max: 200, step: 5 },
  });
  game.settings.register(MODULE_ID, S.STEP_DELAY, {
    name: "beaversMobilePawn.settings.stepDelay.name",
    hint: "beaversMobilePawn.settings.stepDelay.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 180,
    range: { min: 0, max: 1000, step: 20 },
  });
}

export const getSetting = <T = any>(key: string): T => game.settings.get(MODULE_ID, key) as T;

/** Switch Foundry's "Disable Canvas" back off and forget that we had switched it on. */
export function releaseCanvas(): Promise<unknown> {
  try {
    return Promise.all([
      game.settings.set("core", "noCanvas", false),
      game.settings.set(MODULE_ID, S.CANVAS_FLIPPED, false),
    ]).catch((e) => console.warn(`${MODULE_ID} | could not re-enable the canvas`, e));
  } catch (e) {
    console.warn(`${MODULE_ID} | could not re-enable the canvas`, e);
    return Promise.resolve();
  }
}

export const getAssignments = (): Assignments => normalizeAssignments(getSetting(S.ASSIGNMENTS));

/** "Exit" on the phone only lasts for this browser tab, closing it brings the phone back. */
export const hasExitedPhone = (): boolean => {
  try {
    return sessionStorage.getItem(EXIT_KEY) === "1";
  } catch {
    return false;
  }
};
export const setExitedPhone = (exited: boolean) => {
  try {
    if (exited) sessionStorage.setItem(EXIT_KEY, "1");
    else sessionStorage.removeItem(EXIT_KEY);
  } catch {
    /* private mode: the exit then only lasts until the reload, which is acceptable */
  }
};

/**
 * Which part this browser plays. The requested role comes from, strongest first:
 * URL `?bmp=` -> this device's own explicit setting -> what the GM assigned to the user -> guess: small
 * touch screens of non-GM users are phones, everything else stays a normal Foundry client.
 *
 * A requested "phone" is then vetoed for GMs (the phone UI cannot run the game, and a GM stuck in it has
 * no way back to the settings) and when the user pressed exit on the phone earlier in this tab. The
 * exit-memory only ever vetoes "phone": an explicit Table/Off still wins, and changing the device role
 * clears it, so picking Phone again takes effect.
 */
export function resolveRole(): Role {
  const role = requestedRole();
  if (role !== "phone") return role;
  if (game.user.isGM) return "off";
  return hasExitedPhone() ? "off" : "phone";
}

function requestedRole(): Role {
  const param = new URLSearchParams(location.search).get("bmp");
  if (param === "phone" || param === "table" || param === "off") {
    if (param === "phone") setExitedPhone(false);
    return param;
  }
  const device = getSetting<string>(S.ROLE);
  if (device === "phone" || device === "table" || device === "off") return device;
  const assigned = getAssignments()[game.user.id]?.role;
  if (assigned === "phone" || assigned === "table" || assigned === "off") return assigned;
  if (game.user.isGM) return "off";
  const touchOnly = matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches;
  return touchOnly && Math.min(screen.width, screen.height) <= 700 ? "phone" : "off";
}

/** Characters the user may pick on the phone: the GM's list, else everything the user owns. */
export function phoneActorIds(user: any = game.user): string[] {
  const assigned = getAssignments()[user.id]?.actors ?? [];
  const owned: string[] = user.isGM
    ? []
    : game.actors.filter((a: any) => a.testUserPermission(user, "OWNER")).map((a: any) => a.id);
  const fallback = [user.character?.id, ...owned].filter(Boolean) as string[];
  return chooseActorIds(assigned, fallback, (id) => !!game.actors.get(id));
}
