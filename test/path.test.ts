import { describe, expect, it } from "vitest";
import {
  clipPath,
  extendPath,
  extendPathToward,
  lineCells,
  nextStep,
  sanitizePath,
  stepCount,
  toWaypoints,
  type Path,
} from "../src/core/path";

describe("lineCells", () => {
  it("returns nothing for the same cell", () => {
    expect(lineCells([2, 2], [2, 2])).toEqual([]);
  });
  it("walks straight lines", () => {
    expect(lineCells([0, 0], [3, 0])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });
  it("walks diagonals", () => {
    expect(lineCells([0, 0], [2, 2])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
  it("fills the gap of a fast finger with contiguous cells", () => {
    const cells = lineCells([0, 0], [5, 2]);
    expect(cells.at(-1)).toEqual([5, 2]);
    let prev: [number, number] = [0, 0];
    for (const c of cells) {
      expect(Math.max(Math.abs(c[0] - prev[0]), Math.abs(c[1] - prev[1]))).toBe(1);
      prev = [c[0], c[1]];
    }
  });
});

describe("extendPath", () => {
  const start: Path = [[0, 0]];
  it("appends cells towards the target", () => {
    expect(extendPath(start, [2, 0])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });
  it("returns the same instance when the finger has not left the cell", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
    ];
    expect(extendPath(p, [1, 0])).toBe(p);
  });
  it("retraces when dragging back over the path", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(extendPath(p, [1, 0])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
  it("cuts a loop back instead of self-crossing", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(extendPath(p, [0, 0])).toEqual([[0, 0]]);
  });
  it("stops growing at maxSteps", () => {
    const p = extendPath(start, [10, 0], 4);
    expect(stepCount(p)).toBe(4);
    expect(p.at(-1)).toEqual([4, 0]);
  });
});

describe("nextStep", () => {
  it("stays put near the cell's own centre", () => {
    expect(nextStep([0, 0], 0.5, 0.5)).toBeNull();
    expect(nextStep([0, 0], 0.6, 0.4)).toBeNull();
  });
  it("steps diagonally once both axes clear the ordinary halfway point", () => {
    // regression: a naive per-axis floor/round almost never lands exactly here, since a real drag is never
    // pixel-perfect 45 degrees - one axis reaches this a moment before the other, and used to commit an
    // orthogonal step right then, turning every diagonal drag into an "L". Both axes past 0.5 must resolve
    // to one diagonal step, not two orthogonal ones.
    expect(nextStep([0, 0], 1.05, 1.02)).toEqual([1, 1]);
    expect(nextStep([0, 0], 1.001, 1.001)).toEqual([1, 1]);
  });
  it("does not step diagonally on a slight diagonal wobble while dragging mostly straight", () => {
    // one axis clearly past its (higher, lone-axis) bar, the other only a little off centre: still a plain
    // orthogonal step, the wobble alone isn't enough to also justify the diagonal.
    expect(nextStep([0, 0], 1.25, 0.7)).toEqual([1, 0]);
    expect(nextStep([0, 0], 0.7, 1.25)).toEqual([0, 1]);
  });
  it("requires clearing the higher bar for a lone axis", () => {
    expect(nextStep([0, 0], 1.15, 0.5)).toBeNull();
    expect(nextStep([0, 0], 1.25, 0.5)).toEqual([1, 0]);
  });
  it("works from a non-origin cell and in every direction", () => {
    expect(nextStep([2, 3], 3.05, 4.02)).toEqual([3, 4]);
    expect(nextStep([2, 3], 1.48, 2.49)).toEqual([1, 2]);
  });
});

describe("extendPathToward", () => {
  const start: Path = [[0, 0]];
  it("converges on a straight drag", () => {
    expect(extendPathToward(start, 2.5, 0.5)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });
  it("converges on a clean diagonal drag", () => {
    expect(extendPathToward(start, 2.55, 2.52)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });
  it("retraces when dragging back over the path", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(extendPathToward(p, 1.5, 0.5)).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
  it("stops growing at maxSteps", () => {
    const p = extendPathToward(start, 10.5, 0.5, 4);
    expect(stepCount(p)).toBe(4);
    expect(p.at(-1)).toEqual([4, 0]);
  });
  it("returns the same instance when the finger has not left the cell's zone", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
    ];
    expect(extendPathToward(p, 1.5, 0.5)).toBe(p);
  });
});

describe("clipPath", () => {
  const path: Path = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ];
  it("keeps everything when nothing blocks", () => {
    expect(clipPath(path, () => false)).toEqual({ allowed: path, blockedAt: null });
  });
  it("cuts before the first blocked step", () => {
    const r = clipPath(path, (_from, to) => to[0] >= 2);
    expect(r.allowed).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(r.blockedAt).toBe(2);
  });
  it("reports the step that is blocked, not just the cell", () => {
    const r = clipPath(path, (from, to) => from[0] === 0 && to[0] === 1);
    expect(r.allowed).toEqual([[0, 0]]);
    expect(r.blockedAt).toBe(1);
  });
});

describe("toWaypoints", () => {
  it("keeps only corners", () => {
    const p: Path = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ];
    expect(toWaypoints(p)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
  });
  it("handles short paths", () => {
    expect(toWaypoints([[0, 0]])).toEqual([[0, 0]]);
    expect(
      toWaypoints([
        [0, 0],
        [1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("sanitizePath", () => {
  it("accepts a valid path", () => {
    expect(
      sanitizePath(
        [
          [0, 0],
          [1, 1],
        ],
        10,
      ),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
  it("rejects junk", () => {
    expect(sanitizePath("x", 10)).toBeNull();
    expect(
      sanitizePath(
        [
          [0, 0],
          [1.5, 0],
        ],
        10,
      ),
    ).toBeNull();
    expect(sanitizePath([[1, 0]], 10)).toBeNull();
    expect(
      sanitizePath(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        1,
      ),
    ).toBeNull();
  });
  it("rejects teleporting paths", () => {
    expect(
      sanitizePath(
        [
          [0, 0],
          [5, 0],
        ],
        10,
      ),
    ).toBeNull();
  });
});
