import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Door extensions are optional: without Beaver's Solid Doors, and for doors it does not move (no animation, secret
 * doors, ...), a door must stay a plain door that only opens and closes.
 */

// The registry is module state: every test gets fresh modules.
async function load() {
  vi.resetModules();
  const registry = await import("../src/extensions/doorExtensions");
  const solid = await import("../src/extensions/solidDoors");
  return { ...registry, ...solid };
}

const withModules = (modules: Record<string, unknown>) => {
  (globalThis as any).game = { modules: new Map(Object.entries(modules)) };
};

const wall = { id: "w1", door: 1, c: [0, 0, 100, 0] };

/** A stand-in for the solid-doors API: only doors with a swing animation are solid. */
const solidApi = {
  solidConfig: (w: any) => (w.animation?.type === "swing" ? { kind: "swing", max: 90, amount: 40 } : undefined),
  requestDoor: vi.fn(async () => ({})),
  leafSegments: () => [],
  amountToward: () => 0,
  CLOSE_BELOW: 3,
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  delete (globalThis as any).game;
  vi.restoreAllMocks();
});

describe("without Beaver's Solid Doors", () => {
  it("registers nothing when the module is not installed", async () => {
    withModules({});
    const { registerSolidDoors, describeDoor } = await load();
    expect(() => registerSolidDoors()).not.toThrow();
    expect(describeDoor({ ...wall, animation: { type: "swing" } })).toBeUndefined();
  });
  it("registers nothing when the module is installed but not active", async () => {
    withModules({ "beavers-solid-doors": { active: false, api: solidApi } });
    const { registerSolidDoors, describeDoor } = await load();
    registerSolidDoors();
    expect(describeDoor({ ...wall, animation: { type: "swing" } })).toBeUndefined();
  });
  it("registers nothing when the module has no (or an older) API", async () => {
    withModules({ "beavers-solid-doors": { active: true } });
    const { registerSolidDoors, describeDoor } = await load();
    registerSolidDoors();
    expect(describeDoor({ ...wall, animation: { type: "swing" } })).toBeUndefined();
  });
});

describe("with Beaver's Solid Doors", () => {
  it("describes a solid door", async () => {
    withModules({ "beavers-solid-doors": { active: true, api: solidApi } });
    const { registerSolidDoors, describeDoor } = await load();
    registerSolidDoors();
    const described = describeDoor({ ...wall, animation: { type: "swing" } });
    expect(described?.extension.id).toBe("beavers-solid-doors");
    expect(described?.amount).toBe(40);
  });
  it("leaves a door without animation a plain door", async () => {
    withModules({ "beavers-solid-doors": { active: true, api: solidApi } });
    const { registerSolidDoors, describeDoor } = await load();
    registerSolidDoors();
    expect(describeDoor(wall)).toBeUndefined();
    expect(describeDoor({ ...wall, animation: null })).toBeUndefined();
  });
  it("opens a solid door all the way when no amount is given, like a click", async () => {
    withModules({ "beavers-solid-doors": { active: true, api: solidApi } });
    const { registerSolidDoors, describeDoor } = await load();
    registerSolidDoors();
    const door = { ...wall, animation: { type: "swing" } };
    await describeDoor(door)!.extension.use(door, true);
    expect(solidApi.requestDoor).toHaveBeenLastCalledWith(door, true, 90);
  });
});

describe("a broken extension", () => {
  it("does not break the door, it stays plain", async () => {
    withModules({});
    const { registerDoorExtension, describeDoor } = await load();
    registerDoorExtension({
      id: "broken",
      describe: () => {
        throw new Error("boom");
      },
      use: async () => ({}),
      leaf: () => [],
      amountToward: () => 0,
      closeBelow: 3,
      label: () => "",
    });
    expect(describeDoor(wall)).toBeUndefined();
  });
});
