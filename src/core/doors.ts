/**
 * Pure logic for the walls and doors around a token. No Foundry globals in here so it can be unit tested.
 *
 * The table looks from the token centre to the centre of each of the 8 neighbour cells, like a one cell step of a
 * path. If the nearest wall crossing that line is a door, it is reported with its real segment, relative to the
 * token centre in cells, so the phone can draw it where it is. A door behind another wall is out of reach, and
 * plain walls are never sent: the phone only learns about doors it could use.
 */

import type { Cell } from "./path.js";
import type { Seat } from "./seat.js";
import { fromTable } from "./seat.js";

export type Point = { x: number; y: number };
/** A segment [x0, y0, x1, y1]: scene pixels on the table, cells relative to the token centre in messages. */
export type Segment = readonly [number, number, number, number];

/** The 8 neighbour directions, table orientation. */
export const NEIGHBOURS: readonly Cell[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** A wall the line to one neighbour crosses. */
export interface WallHit {
  id: string;
  c: Segment;
  /** Where along the line it crosses, 0 = token centre, 1 = neighbour centre. */
  t: number;
  /** A door the player may use: a normal door, never a secret one. */
  door: boolean;
  open: boolean;
}

/** A door on the line to one neighbour, as sent to the phone. */
export interface AroundDir {
  dir: Cell;
  door: { id: string; open: boolean; c: Segment };
}

/** Where segment c-d crosses segment a-b, as t along a-b (0..1), or null. Touching an end counts. */
export function crossing(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return null; // parallel or collinear: the line runs along the wall, it does not cross it
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return Math.min(1, Math.max(0, t));
}

const round = (v: number) => Math.round(v * 1000) / 1000 + 0; // + 0: no -0 in messages

/** The door the phone may use in one direction: the nearest wall on the line, if it is a door. */
export function doorInDirection(dir: Cell, hits: WallHit[], origin: Point, cell: number): AroundDir | undefined {
  const first = hits.reduce<WallHit | undefined>((best, h) => (!best || h.t < best.t ? h : best), undefined);
  if (!first?.door) return undefined;
  const [x0, y0, x1, y1] = first.c;
  const c: Segment = [
    round((x0 - origin.x) / cell),
    round((y0 - origin.y) / cell),
    round((x1 - origin.x) / cell),
    round((y1 - origin.y) / cell),
  ];
  return { dir, door: { id: first.id, open: first.open, c } };
}

/** The table's directions and door segments turned into what the player sees on the phone. */
export function aroundToPad(around: AroundDir[], seat: Seat): AroundDir[] {
  return around.map(({ dir, door }) => {
    const [x0, y0, x1, y1] = door.c;
    const [a0, b0] = fromTable([x0, y0], seat);
    const [a1, b1] = fromTable([x1, y1], seat);
    return { dir: fromTable(dir, seat), door: { ...door, c: [a0, b0, a1, b1] } };
  });
}

/** Validate untrusted network input into a list of directions. Drops what does not fit. */
export function sanitizeAround(raw: unknown): AroundDir[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const out: AroundDir[] = [];
  for (const a of raw.slice(0, NEIGHBOURS.length)) {
    const d = a?.dir;
    if (!Array.isArray(d) || !Number.isInteger(d[0]) || !Number.isInteger(d[1])) continue;
    if (Math.abs(d[0]) > 1 || Math.abs(d[1]) > 1 || (d[0] === 0 && d[1] === 0)) continue;
    const door = a.door;
    if (!door || typeof door.id !== "string" || typeof door.open !== "boolean") continue;
    if (!Array.isArray(door.c) || door.c.length !== 4 || !door.c.every(num)) continue;
    out.push({ dir: [d[0], d[1]], door: { id: door.id, open: door.open, c: [door.c[0], door.c[1], door.c[2], door.c[3]] } });
  }
  return out;
}
