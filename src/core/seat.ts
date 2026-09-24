import type { Cell } from "./path.js";

/** Which edge of the table screen a player sits at. "bottom" is the screen's own orientation. */
export const SEATS = ["bottom", "left", "top", "right"] as const;
export type Seat = (typeof SEATS)[number];

/**
 * Quarter turns, clockwise on screen, from what the player means to what the table shows. A player at the left
 * edge looks right across the table: pushing up on the phone (away from them) means right on the screen.
 */
const TURNS: Record<Seat, number> = { bottom: 0, left: 1, top: 2, right: 3 };

const neg = (v: number) => 0 - v; // 0 - 0 is +0, so no -0 leaks into messages or comparisons

/** A pad direction/offset as the player sees it -> the same offset on the table screen. */
export function toTable([x, y]: Cell, seat: Seat = "bottom"): Cell {
  switch (TURNS[seat] ?? 0) {
    case 1:
      return [neg(y), x];
    case 2:
      return [neg(x), neg(y)];
    case 3:
      return [y, neg(x)];
    default:
      return [x, y];
  }
}

/** A screen angle (radians, 0 = right, clockwise) as the player sees it -> the angle on the table screen. */
export function angleToTable(angle: number, seat: Seat = "bottom"): number {
  return angle + ((TURNS[seat] ?? 0) * Math.PI) / 2;
}
