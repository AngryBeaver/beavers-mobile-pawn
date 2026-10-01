import type { DoorExtension, Point, Segment } from "../core/doors.js";
import { registerDoorExtension } from "./doorExtensions.js";

/**
 * Beaver's Solid Doors: doors that swing, swivel or slide by any amount, and block where they stand.
 * Uses its public API, so neither module needs the other.
 */

const SOLID_DOORS = "beavers-solid-doors";

/** Solid Doors rounds its segments to whole units: scale the phone's cells up so that costs no precision. */
const SCALE = 1000;
const up = (s: Segment): Segment => [s[0] * SCALE, s[1] * SCALE, s[2] * SCALE, s[3] * SCALE];
const down = (s: Segment): Segment => [s[0] / SCALE, s[1] / SCALE, s[2] / SCALE, s[3] / SCALE];
const upPoint = (p: Point): Point => ({ x: p.x * SCALE, y: p.y * SCALE });

export function registerSolidDoors() {
  const module = game.modules.get(SOLID_DOORS);
  const api = module?.active ? module.api : undefined;
  if (!api?.solidConfig || !api.requestDoor || !api.leafSegments || !api.amountToward) return;

  const extension: DoorExtension = {
    id: SOLID_DOORS,
    describe(wall) {
      const config = api.solidConfig(wall);
      return config ? { config, amount: config.amount } : undefined;
    },
    async use(wall, open, amount) {
      // Like clicking the door icon: opening without an amount opens all the way
      const config = api.solidConfig(wall);
      const result = await api.requestDoor(wall, open, open ? (amount ?? config?.max) : undefined);
      return { error: result?.error };
    },
    leaf: (config, c, amount) => api.leafSegments(up(c), config, amount).map(down),
    amountToward: (config, c, pointer, grab) =>
      api.amountToward(up(c), config, upPoint(pointer), { pointer: upPoint(grab.pointer), amount: grab.amount }),
    closeBelow: api.CLOSE_BELOW ?? 3,
    label: (config: any, amount) => (config?.kind === "slide" ? `${Math.round(amount)} %` : `${Math.round(amount)}°`),
  };
  registerDoorExtension(extension);
}
