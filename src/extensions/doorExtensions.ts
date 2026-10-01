import type { DoorExtension } from "../core/doors.js";
import { MODULE_ID } from "../core/protocol.js";

/**
 * Door extensions: modules that make doors move by an amount (see DoorExtension). Without any, doors only open and
 * close. Other modules can register their own with `game.modules.get("beavers-mobile-pawn").api.registerDoorExtension`,
 * on every client (in "init" or "setup").
 */

const extensions: DoorExtension[] = [];

export function registerDoorExtension(extension: DoorExtension) {
  if (extensions.some((e) => e.id === extension.id)) return;
  extensions.push(extension);
}

export function doorExtension(id: string | undefined): DoorExtension | undefined {
  return id ? extensions.find((e) => e.id === id) : undefined;
}

/** The first extension that handles this WallDocument, with its description of the door. */
export function describeDoor(wall: any): { extension: DoorExtension; config: unknown; amount: number } | undefined {
  for (const extension of extensions) {
    try {
      const described = extension.describe(wall);
      if (described) return { extension, ...described };
    } catch (e) {
      console.error(`${MODULE_ID} | door extension ${extension.id} failed on wall ${wall?.id}`, e);
    }
  }
  return undefined;
}

export function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { ...(module.api ?? {}), registerDoorExtension };
}
