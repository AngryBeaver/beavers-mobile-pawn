import { describe, expect, it } from "vitest";
import {
  aroundToPad,
  crossing,
  doorInDirection,
  NEIGHBOURS,
  sanitizeAround,
  segmentToPad,
  type Segment,
  type WallHit,
} from "../src/core/doors";
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

describe("segmentToPad", () => {
  // A door extension computes leaves and drag amounts in the phone's frame. That only matches the table if every seat
  // is a turn, never a mirror: a door swinging clockwise on the table must swing clockwise on the phone too.
  const turnClockwise = ([x0, y0, x1, y1]: Segment, deg: number): Segment => {
    const r = (deg * Math.PI) / 180;
    const dx = x1 - x0;
    const dy = y1 - y0;
    return [x0, y0, x0 + dx * Math.cos(r) - dy * Math.sin(r), y0 + dx * Math.sin(r) + dy * Math.cos(r)];
  };
  const close = (a: Segment, b: Segment) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

  it("turns a door the same way on every seat", () => {
    const door: Segment = [0.5, -0.5, 0.5, 0.5];
    for (const seat of SEATS) {
      for (const deg of [30, 90, -45, 180]) {
        close(segmentToPad(turnClockwise(door, deg), seat), turnClockwise(segmentToPad(door, seat), deg));
      }
    }
  });
});

describe("aroundToPad", () => {
  it("turns the closed door of a moving door too", () => {
    const motion = { ext: "x", config: { kind: "swing" }, amount: 45, c: [0.5, -0.5, 0.5, 0.5] as const };
    const [a] = aroundToPad([{ dir: [1, 0], door: { id: "d", open: true, c: [0.5, -0.5, 1.2, -0.5], motion } }], "left");
    expect(a.door.motion?.c).toEqual([-0.5, -0.5, 0.5, -0.5]);
    expect(a.door.motion?.config).toEqual({ kind: "swing" });
    expect(a.door.motion?.amount).toBe(45);
  });
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
  it("keeps a good motion and drops a broken one, but not the door", () => {
    const c = [0, 0, 1, 1];
    const motion = { ext: "solid", config: { kind: "slide" }, amount: 30, c: [0, 0, 1, 0] };
    const out = sanitizeAround([
      { dir: [1, 0], door: { id: "a", open: true, c, motion } },
      { dir: [0, 1], door: { id: "b", open: true, c, motion: { ext: "solid", amount: "x", c } } },
    ]);
    expect(out[0].door.motion).toEqual(motion);
    expect(out[1].door).toEqual({ id: "b", open: true, c });
  });
  it("accepts nothing that is no list", () => {
    expect(sanitizeAround(undefined)).toEqual([]);
  });
});
