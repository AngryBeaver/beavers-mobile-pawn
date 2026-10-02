import type { AroundDir } from "./doors.js";
import type { Path } from "./path.js";

export const MODULE_ID = "beavers-mobile-pawn";
export const SOCKET_NAME = `module.${MODULE_ID}`;

/** phone -> table: the path being dragged. Sent repeatedly while dragging and once more on release. */
export interface PathMessage {
  type: "path";
  userId: string;
  actorId: string;
  /** Increases with every message of one gesture; results echo it so stale answers can be ignored. */
  seq: number;
  /** true on release: the phone is now waiting for a final answer before it lets the player confirm. */
  final: boolean;
  steps: Path;
}

/** table -> phone: what the table could make of the path. */
export interface PathResultMessage {
  type: "result";
  to: string;
  seq: number;
  ok: boolean;
  /** Reason when ok is false: "no-token" | "no-scene" | "no-square-grid" | "not-owner". */
  error?: string;
  /** Number of leading cells of the path that are walkable, including the origin. */
  allowed?: number;
  blocked?: boolean;
  sceneId?: string;
  tokenId?: string;
  /** Token document top-left x/y in scene pixels, and pixel size of one grid cell. */
  originX?: number;
  originY?: number;
  cell?: number;
  /** Walkable distance in scene units, e.g. 25 ft. */
  distance?: number;
  units?: string;
}

/** phone -> table: drop the overlay (cancelled, or the move was committed). */
export interface ClearMessage {
  type: "clear";
  userId: string;
  moved: boolean;
}

/** phone -> table: which token of this actor is on the table's scene? Sent when the player starts turning it. */
export interface LocateMessage {
  type: "locate";
  userId: string;
  actorId: string;
}

/** table -> phone: answer to LocateMessage. */
export interface LocatedMessage {
  type: "located";
  to: string;
  actorId: string;
  ok: boolean;
  error?: string;
  sceneId?: string;
  tokenId?: string;
  /** The doors the token can reach, per neighbour cell, table orientation. */
  around?: AroundDir[];
}

/** phone -> table: open or close a door next to the actor's token. The target state, never "toggle". */
export interface DoorMessage {
  type: "door";
  userId: string;
  actorId: string;
  seq: number;
  wallId: string;
  open: boolean;
  /** How far to open a door a door extension moves (see DoorMotion). Without it the door opens all the way. */
  amount?: number;
}

/** table -> phone: answer to DoorMessage. */
export interface DoorResultMessage {
  type: "doorResult";
  to: string;
  seq: number;
  ok: boolean;
  /** The door's state afterwards. */
  open?: boolean;
  /** "locked" | "paused" | "out-of-reach" | "not-allowed" | "no-token" | "no-scene" | "not-owner" | "table-error" */
  error?: string;
}

export type PawnMessage =
  PathMessage | PathResultMessage | ClearMessage | LocateMessage | LocatedMessage | DoorMessage | DoorResultMessage;
