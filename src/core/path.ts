/**
 * Pure grid-path logic. No Foundry globals in here so it can be unit tested.
 *
 * A path is a list of cell offsets relative to the start cell (the cell the player first touched on the
 * phone). It always begins with [0, 0]. The phone knows nothing about the map, only these offsets.
 */

export type Cell = readonly [number, number];
export type Path = Cell[];

export const ORIGIN: Cell = [0, 0];

export function sameCell(a: Cell, b: Cell): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Cells on the straight line from a to b (Bresenham), excluding a, including b. 8-directional. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x);
  const dy = Math.abs(b[1] - y);
  const sx = x < b[0] ? 1 : -1;
  const sy = y < b[1] ? 1 : -1;
  let err = dx - dy;
  while (x !== b[0] || y !== b[1]) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    cells.push([x, y]);
  }
  return cells;
}

/**
 * Extend a path towards `target`, one contiguous cell at a time.
 * - Touching a cell that is already on the path retraces: the path is cut back to that cell.
 * - Growth stops at `maxSteps` (number of moves, not counting the origin).
 * Returns the same array instance when nothing changed.
 */
export function extendPath(path: Path, target: Cell, maxSteps = Infinity): Path {
  let result = path;
  for (const cell of lineCells(path[path.length - 1], target)) {
    const seen = result.findIndex((c) => sameCell(c, cell));
    if (seen >= 0) {
      result = result.slice(0, seen + 1);
    } else if (result.length - 1 < maxSteps) {
      result = [...result, cell];
    } else {
      break;
    }
  }
  return result;
}

// A step on a single axis alone needs to clear this higher bar; once the other axis has already cleared the
// ordinary halfway point too, the lower bar is enough. See nextStep below for why.
const DIAGONAL_BIAS = 0.5;
const ORTHO_BIAS = 0.7;

/**
 * Picks the next single cell to step into from `from`, given the drag's current raw position in the same
 * fractional cell-unit space as `from` (integer cell N spans [N, N+1), so N+0.5 is its centre). Returns null
 * once the position is close enough to `from`'s centre that no new cell is warranted yet.
 *
 * A real finger drag is essentially never pixel-perfect diagonal, so quantizing each axis independently (a
 * plain floor/round of the raw position) has one axis cross its cell boundary a moment before the other on
 * essentially every diagonal drag - turning it into an "L" of two orthogonal steps instead of one diagonal
 * one, because whichever axis crosses first gets committed to the path immediately. Requiring a single axis
 * to lean further before it counts on its own gives the other axis time to catch up if the drag really is
 * diagonal; once both have leaned past the ordinary halfway point, the diagonal step is allowed to land as
 * one move.
 */
export function nextStep(from: Cell, rawX: number, rawY: number): Cell | null {
  const dx = rawX - (from[0] + 0.5);
  const dy = rawY - (from[1] + 0.5);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const wantX = ax >= (ay >= DIAGONAL_BIAS ? DIAGONAL_BIAS : ORTHO_BIAS);
  const wantY = ay >= (ax >= DIAGONAL_BIAS ? DIAGONAL_BIAS : ORTHO_BIAS);
  if (!wantX && !wantY) return null;
  return [from[0] + (wantX ? Math.sign(dx) : 0), from[1] + (wantY ? Math.sign(dy) : 0)];
}

/**
 * Extend a path towards the drag's current raw position (same fractional space as nextStep), one diagonal-
 * biased cell at a time.
 * - Touching a cell that is already on the path retraces: the path is cut back to that cell.
 * - Growth stops at `maxSteps` (number of moves, not counting the origin).
 * Returns the same array instance when nothing changed.
 */
export function extendPathToward(path: Path, rawX: number, rawY: number, maxSteps = Infinity): Path {
  let result = path;
  // A single call converges fully towards the raw position; this guard is only a defensive backstop.
  for (let guard = 0; guard < 4096; guard++) {
    const step = nextStep(result[result.length - 1], rawX, rawY);
    if (!step) break;
    const seen = result.findIndex((c) => sameCell(c, step));
    if (seen >= 0) {
      result = result.slice(0, seen + 1);
    } else if (result.length - 1 < maxSteps) {
      result = [...result, step];
    } else {
      break;
    }
  }
  return result;
}

export interface ClipResult {
  /** The part of the path that can actually be walked (always contains the origin). */
  allowed: Path;
  /** Index into the original path of the first cell that could not be entered, or null if nothing blocks. */
  blockedAt: number | null;
}

/** Cut the path at the first step for which `isBlocked(from, to)` is true. */
export function clipPath(path: Path, isBlocked: (from: Cell, to: Cell) => boolean): ClipResult {
  for (let i = 1; i < path.length; i++) {
    if (isBlocked(path[i - 1], path[i])) {
      return { allowed: path.slice(0, i), blockedAt: i };
    }
  }
  return { allowed: path, blockedAt: null };
}

/** Reduce a path to its corner points (drops cells that continue in the same direction). */
export function toWaypoints(path: Path): Path {
  if (path.length <= 2) return [...path];
  const out: Path = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const inDir = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
    const outDir = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]];
    if (inDir[0] !== outDir[0] || inDir[1] !== outDir[1]) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Number of moves in a path. */
export function stepCount(path: Path): number {
  return Math.max(0, path.length - 1);
}

/** Validate untrusted network input into a Path (integers only, starts at origin, bounded length). */
export function sanitizePath(raw: unknown, maxSteps: number): Path | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxSteps + 1) return null;
  const path: Path = [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])) return null;
    path.push([c[0], c[1]]);
  }
  if (!sameCell(path[0], ORIGIN)) return null;
  for (let i = 1; i < path.length; i++) {
    if (Math.abs(path[i][0] - path[i - 1][0]) > 1 || Math.abs(path[i][1] - path[i - 1][1]) > 1) return null;
  }
  return path;
}
