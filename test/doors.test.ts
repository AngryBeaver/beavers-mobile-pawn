import { describe, expect, it } from "vitest";
import { aroundToPad, crossing, doorInDirection, NEIGHBOURS, sanitizeAround, type WallHit } from "../src/core/doors";
import { fromTable, SEATS, toTable } from "../src/core/seat";

const O = { x: 0, y: 0 };

describe("crossing", () => {
  it("finds where a wall crosses the line", () => {
    expect(crossing(O, { x: 100, y: 0 }, { x: 50, y: -10 }, { x: 50, y: 10 })).toBeCloseTo(0.5);
  });
  it("counts walls inside the own cell and just before the neighbour centre", () => {
    expect(crossing(O, { x: 100, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 })).toBeCloseTo(0.1);
    expect(crossing(O, { x: 100, y: 0 }, { x: 99, y: -5 }, { x: 99, y: 5 })).toBeCloseTo(0.99);
  });
  it("misses walls beside or beyond the line", () => {
    expect(crossing(O, { x: 100, y: 0 }, { x: 50, y: 5 }, { x: 50, y: 20 })).toBeNull();
    expect(crossing(O, { x: 100, y: 0 }, { x: 150, y: -10 }, { x: 150, y: 10 })).toBeNull();
  });
  it("ignores walls running along the line", () => {
    expect(crossing(O, { x: 100, y: 0 }, { x: 20, y: 0 }, { x: 80, y: 0 })).toBeNull();
  });
  it("works for a diagonal wall across a diagonal step", () => {
    expect(crossing(O, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(0.5);
  });
});

describe("doorInDirection", () => {
  const hit = (id: string, t: number, door = false, open = false): WallHit => ({
    id,
    t,
    c: [100 + t * 100, 0, 100 + t * 100, 100],
    door,
    open,
  });
  const origin = { x: 150, y: 50 };

  it("offers the door when it is the nearest wall", () => {
    const a = doorInDirection([1, 0], [hit("wall", 0.8), hit("door", 0.4, true)], origin, 100);
    expect(a?.door).toMatchObject({ id: "door", open: false });
  });
  it("offers nothing when a plain wall stands before the door", () => {
    expect(doorInDirection([1, 0], [hit("door", 0.8, true, true), hit("wall", 0.4)], origin, 100)).toBeUndefined();
  });
  it("offers nothing for plain walls alone", () => {
    expect(doorInDirection([1, 0], [hit("wall", 0.4)], origin, 100)).toBeUndefined();
    expect(doorInDirection([1, 0], [], origin, 100)).toBeUndefined();
  });
  it("sends the real door segment, relative to the token centre in cells", () => {
    const a = doorInDirection([1, 0], [hit("door", 0.5, true)], origin, 100);
    expect(a?.door.c).toEqual([0, -0.5, 0, 0.5]);
  });
});

describe("fromTable", () => {
  it("undoes toTable for every seat", () => {
    for (const seat of SEATS) {
      for (const d of NEIGHBOURS) expect(fromTable(toTable(d, seat), seat)).toEqual(d);
    }
  });
});

describe("aroundToPad", () => {
  it("turns direction and door segment for a player at the left edge", () => {
    // table right is the left-seat player's up
    const [a] = aroundToPad([{ dir: [1, 0], door: { id: "d", open: false, c: [0.5, -0.5, 0.5, 0.5] } }], "left");
    expect(a.dir).toEqual([0, -1]);
    expect(a.door.c).toEqual([-0.5, -0.5, 0.5, -0.5]);
  });
});

describe("sanitizeAround", () => {
  it("keeps good entries and drops broken ones", () => {
    const good = { id: "a", open: true, c: [0, 0, 1, 1] };
    const out = sanitizeAround([
      { dir: [1, 0], door: good },
      { dir: [0, 0], door: good },
      { dir: [2, 0], door: good },
      { dir: [0, 1], door: { id: "b", open: false, c: [0, "x", 1, 1] } },
      { dir: [-1, 0], door: { id: 5, open: false, c: [0, 0, 1, 1] } },
      { dir: [0, -1] },
    ]);
    expect(out).toEqual([{ dir: [1, 0], door: good }]);
  });
  it("accepts nothing that is no list", () => {
    expect(sanitizeAround(undefined)).toEqual([]);
  });
});
