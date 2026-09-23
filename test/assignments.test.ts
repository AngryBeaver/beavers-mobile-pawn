import { describe, expect, it } from "vitest";
import { chooseActorIds, normalizeAssignments, pickActor } from "../src/core/assignments";

describe("normalizeAssignments", () => {
  it("survives garbage", () => {
    expect(normalizeAssignments(null)).toEqual({});
    expect(normalizeAssignments("x")).toEqual({});
    expect(normalizeAssignments({ a: 5, b: null })).toEqual({});
  });
  it("drops entries that say nothing", () => {
    expect(normalizeAssignments({ a: { role: "auto", actors: [] } })).toEqual({});
  });
  it("falls back to auto for unknown roles and dedupes actors", () => {
    expect(normalizeAssignments({ a: { role: "boss", actors: ["x", "x", 3, "y"] } })).toEqual({
      a: { role: "auto", actors: ["x", "y"] },
    });
  });
  it("keeps a role without actors", () => {
    expect(normalizeAssignments({ a: { role: "table" } })).toEqual({ a: { role: "table", actors: [] } });
  });
});

describe("chooseActorIds", () => {
  const exists = (id: string) => id !== "gone";
  it("prefers the explicit list", () => {
    expect(chooseActorIds(["a", "b"], ["c"], exists)).toEqual(["a", "b"]);
  });
  it("falls back when nothing is assigned", () => {
    expect(chooseActorIds([], ["c", "c", "d"], exists)).toEqual(["c", "d"]);
  });
  it("falls back when every assigned actor was deleted", () => {
    expect(chooseActorIds(["gone"], ["c"], exists)).toEqual(["c"]);
  });
});

describe("pickActor", () => {
  it("keeps the preferred one when allowed", () => {
    expect(pickActor(["a", "b"], "b")).toBe("b");
  });
  it("takes the first otherwise", () => {
    expect(pickActor(["a", "b"], "z")).toBe("a");
    expect(pickActor(["a", "b"])).toBe("a");
    expect(pickActor([])).toBeUndefined();
  });
});
