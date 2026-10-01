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

/**
 * How a door moves, when a door extension (e.g. Beaver's Solid Doors) handles it. The phone then shows the door where
 * it stands and can drag it open by any amount. Without one, a door only opens and closes.
 */
export interface DoorMotion {
  /** The extension's id, see DoorExtension. */
  ext: string;
  /** The extension's own description of the door (JSON), only the extension reads it. */
  config: unknown;
  /** How far the door is open (degrees, percent, whatever the extension uses) while it is open. */
  amount: number;
  /** The closed door, relative to the token centre in cells. */
  c: Segment;
}

/** A door on the line to one neighbour, as sent to the phone. */
export interface AroundDir {
  dir: Cell;
  /** c: the wall the line crosses, where it stands now (an open moving door: its leaf). */
  door: { id: string; open: boolean; c: Segment; motion?: DoorMotion };
}

/** Where a drag started: the pointer and how far the door was open then. */
export interface Grab {
  pointer: Point;
  amount: number;
}

/**
 * A module that makes doors move by an amount instead of only opening and closing. Registered on every client
 * (table and phone load the same modules). Frames: the phone calls leaf and amountToward with the door and pointer
 * in its own grid, which is the scene turned and scaled, never mirrored, so angles keep their sense.
 */
export interface DoorExtension {
  id: string;
  /** How this WallDocument moves, or undefined if this extension does not handle it. Works without a canvas. */
  describe(wall: any): { config: unknown; amount: number } | undefined;
  /** Table: open (to `amount`, all the way if undefined) or close the door. */
  use(wall: any, open: boolean, amount?: number): Promise<{ error?: string }>;
  /** Where the door stands when open by `amount`; one segment per moving part. */
  leaf(config: unknown, c: Segment, amount: number): Segment[];
  /** The amount that puts the door at `pointer`. */
  amountToward(config: unknown, c: Segment, pointer: Point, grab: Grab): number;
  /** A drag below this amount closes the door. */
  closeBelow: number;
  /** The amount for people, e.g. "45°" or "30 %". */
  label(config: unknown, amount: number): string;
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

/** A segment in scene pixels, relative to `origin` in cells. */
export function relative([x0, y0, x1, y1]: Segment, origin: Point, cell: number): Segment {
  return [
    round((x0 - origin.x) / cell),
    round((y0 - origin.y) / cell),
    round((x1 - origin.x) / cell),
    round((y1 - origin.y) / cell),
  ];
}

/** The door the phone may use in one direction: the nearest wall on the line, if it is a door. */
export function doorInDirection(dir: Cell, hits: WallHit[], origin: Point, cell: number): AroundDir | undefined {
  const first = hits.reduce<WallHit | undefined>((best, h) => (!best || h.t < best.t ? h : best), undefined);
  if (!first?.door) return undefined;
  return { dir, door: { id: first.id, open: first.open, c: relative(first.c, origin, cell) } };
}

/** A segment turned from the table's orientation into the player's. A turn, so a door still opens the same way. */
export function segmentToPad([x0, y0, x1, y1]: Segment, seat: Seat): Segment {
  const [a0, b0] = fromTable([x0, y0], seat);
  const [a1, b1] = fromTable([x1, y1], seat);
  return [a0, b0, a1, b1];
}

/** The table's directions and door segments turned into what the player sees on the phone. */
export function aroundToPad(around: AroundDir[], seat: Seat): AroundDir[] {
  return around.map(({ dir, door }) => {
    const motion = door.motion && { ...door.motion, c: segmentToPad(door.motion.c, seat) };
    return { dir: fromTable(dir, seat), door: { ...door, c: segmentToPad(door.c, seat), ...(motion ? { motion } : {}) } };
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
    const segment = (s: unknown): Segment | undefined =>
      Array.isArray(s) && s.length === 4 && s.every(num) ? [s[0], s[1], s[2], s[3]] : undefined;
    const c = segment(door.c);
    if (!c) continue;
    const m = door.motion;
    const mc = segment(m?.c);
    const motion: DoorMotion | undefined =
      m && typeof m.ext === "string" && num(m.amount) && mc ? { ext: m.ext, config: m.config, amount: m.amount, c: mc } : undefined;
    out.push({ dir: [d[0], d[1]], door: { id: door.id, open: door.open, c, ...(motion ? { motion } : {}) } });
  }
  return out;
}
