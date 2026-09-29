import { crossing, doorInDirection, NEIGHBOURS, type AroundDir, type WallHit } from "../core/doors.js";
import { clipPath, sanitizePath, stepCount, type Cell, type Path } from "../core/path.js";
import {
  SOCKET_NAME,
  type ClearMessage,
  type DoorMessage,
  type DoorResultMessage,
  type LocateMessage,
  type PathMessage,
  type PathResultMessage,
  type PawnMessage,
} from "../core/protocol.js";
import { getSetting, S } from "../settings.js";

const STALE_MS = 20000;

/** The actor's token on the scene, a visible one if there are several. */
function findToken(scene: any, actorId: string): any {
  const tokens = scene.tokens.filter((t: any) => t.actorId === actorId);
  return tokens.find((t: any) => !t.hidden) ?? tokens[0];
}

/** The token's centre in scene pixels, with elevation. */
function tokenCenter(token: any, cell: number): { x: number; y: number; elevation: number } {
  // v14: getCenterPoint() honours token shape and elevation (walls can be elevation bound). v13 fallback below.
  const c = token.getCenterPoint?.() ?? {
    x: token.x + (token.width * cell) / 2,
    y: token.y + (token.height * cell) / 2,
  };
  return { x: c.x, y: c.y, elevation: c.elevation ?? token.elevation };
}

/** v14 keeps walls per level, the table shows one. v13 has no levels. */
const onViewedLevel = (wall: any) => (canvas.level && wall.includedInLevel ? wall.includedInLevel(canvas.level) : true);

/**
 * The doors the token can reach: per neighbour cell, the nearest wall on the line from the token centre to that
 * cell's centre (the same line a one cell step of a path is checked on), if it is a door. Walls that block movement
 * come from Foundry's own collision test (one-way walls, wall types and levels as for moving), so a door behind a
 * wall is out of reach. Open doors block nothing, so they are looked for separately: they can still be closed.
 */
function scanAround(scene: any, token: any): AroundDir[] {
  const cell: number = scene.grid.size;
  const c0 = tokenCenter(token, cell);
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  const { DOOR } = CONST.WALL_DOOR_TYPES;
  const { OPEN } = CONST.WALL_DOOR_STATES; // ds, not isOpen: v13 documents have no isOpen
  const openDoors = scene.walls.filter((w: any) => w.door === DOOR && w.ds === OPEN && onViewedLevel(w));

  return NEIGHBOURS.flatMap((dir) => {
    const b = { x: c0.x + dir[0] * cell, y: c0.y + dir[1] * cell, elevation: c0.elevation };
    const hits: WallHit[] = [];
    const add = (wall: any) => {
      const [x0, y0, x1, y1] = wall.c;
      const t = crossing(c0, b, { x: x0, y: y0 }, { x: x1, y: y1 });
      if (t === null) return;
      hits.push({ id: wall.id, c: [x0, y0, x1, y1], t, door: wall.door === DOOR, open: wall.ds === OPEN });
    };
    const collisions = backend?.testCollision(c0, b, { type: "move", mode: "all" }) ?? [];
    for (const vertex of collisions) {
      for (const edge of vertex.edges ?? []) {
        // v14 edges point to the WallDocument, v13 to the Wall placeable. Scene bounds have no object.
        const wall = edge.object?.document ?? edge.object;
        if (wall?.documentName === "Wall") add(wall);
      }
    }
    for (const wall of openDoors) add(wall);
    return doorInDirection(dir, hits, c0, cell) ?? [];
  });
}

interface Entry {
  gfx: any;
  label: any;
  timer?: number;
}

/**
 * Runs on the table screen: receives the path a phone is dragging, clips it against the scene's walls,
 * draws it on the canvas and answers the phone with the clipped result.
 */
export class TableOverlay {
  private container: any;
  private entries = new Map<string, Entry>();

  start() {
    game.socket.on(SOCKET_NAME, (msg: PawnMessage) => {
      if (msg.type === "path") this.onPath(msg);
      else if (msg.type === "clear") this.onClear(msg);
      else if (msg.type === "locate") this.onLocate(msg);
      else if (msg.type === "door") void this.onDoor(msg);
    });
    Hooks.on("canvasReady", () => this.attach());
    Hooks.on("canvasTearDown", () => this.detach());
    if (canvas?.ready) this.attach();
  }

  private attach() {
    this.detach();
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    canvas.interface.addChild(this.container);
  }

  private detach() {
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
    this.container?.destroy({ children: true });
    this.container = undefined;
  }

  private reply(msg: PathResultMessage) {
    game.socket.emit(SOCKET_NAME, msg);
  }

  private onPath(msg: PathMessage) {
    const fail = (error: string) => this.reply({ type: "result", to: msg.userId, seq: msg.seq, ok: false, error });
    // Never stay silent: a phone that gets no answer only says "table did not answer".
    try {
      this.handlePath(msg, fail);
    } catch (e) {
      console.error("beavers-mobile-pawn | table could not handle a path", e);
      fail("table-error");
    }
  }

  private handlePath(msg: PathMessage, fail: (error: string) => void) {
    const scene = canvas?.scene;
    if (!scene || !canvas.ready) return fail("no-scene");
    if (scene.grid.type !== CONST.GRID_TYPES.SQUARE) return fail("no-square-grid");

    const path = sanitizePath(msg.steps, getSetting<number>(S.MAX_STEPS));
    const user = game.users.get(msg.userId);
    if (!path || !user) return fail("bad-path");
    // The table user usually has no permission on the players' characters, so game.actors may not contain this
    // actor here. Then the permission check is skipped: the phone's token.move is checked by the server anyway.
    const actor = game.actors.get(msg.actorId);
    if (actor && !actor.testUserPermission(user, "OWNER")) return fail("not-owner");

    const token = findToken(scene, msg.actorId);
    if (!token) return fail("no-token");

    const cell: number = scene.grid.size;
    const c0 = tokenCenter(token, cell);
    const centerOf = ([dx, dy]: Cell) => ({ x: c0.x + dx * cell, y: c0.y + dy * cell, elevation: c0.elevation });

    const backend = CONFIG.Canvas?.polygonBackends?.move;
    const isBlocked = (a: Cell, b: Cell) => !!backend?.testCollision(centerOf(a), centerOf(b), { type: "move", mode: "any" });
    const { allowed, blockedAt } = clipPath(path, isBlocked);

    this.draw(msg.userId, path, allowed, centerOf, cell, user, scene);
    this.reply({
      type: "result",
      to: msg.userId,
      seq: msg.seq,
      ok: true,
      allowed: allowed.length,
      blocked: blockedAt !== null,
      sceneId: scene.id,
      tokenId: token.id,
      originX: token.x,
      originY: token.y,
      cell,
      distance: stepCount(allowed) * scene.grid.distance,
      units: scene.grid.units,
    });
  }

  /**
   * The phone turns the token itself (it owns it), it only needs to know which one is on this scene.
   * The answer also carries the doors next to the token, so the phone can show them while the finger
   * slides over the neighbour cells without asking again.
   */
  private onLocate(msg: LocateMessage) {
    const scene = canvas?.ready ? canvas.scene : undefined;
    const token = scene && findToken(scene, msg.actorId);
    let around: AroundDir[] | undefined;
    try {
      if (token) around = scanAround(scene, token);
    } catch (e) {
      console.error("beavers-mobile-pawn | table could not scan the doors around a token", e);
    }
    game.socket.emit(SOCKET_NAME, {
      type: "located",
      to: msg.userId,
      actorId: msg.actorId,
      ok: !!token,
      error: scene ? (token ? undefined : "no-token") : "no-scene",
      sceneId: scene?.id,
      tokenId: token?.id,
      around,
    });
  }

  private async onDoor(msg: DoorMessage) {
    const reply = (r: Partial<DoorResultMessage>) =>
      game.socket.emit(SOCKET_NAME, { type: "doorResult", to: msg.userId, seq: msg.seq, ok: false, ...r });
    try {
      const error = this.checkDoor(msg);
      if (error) {
        // Like Foundry's door control: a locked door rattles, on this screen only, where the players are.
        if (error === "locked") canvas.scene?.walls.get(msg.wallId)?.object?._playDoorSound?.("test");
        return reply({ error });
      }
      const wall = canvas.scene.walls.get(msg.wallId);
      const { OPEN, CLOSED } = CONST.WALL_DOOR_STATES;
      if ((wall.ds === OPEN) !== msg.open) await wall.update({ ds: msg.open ? OPEN : CLOSED });
      reply({ ok: true, open: msg.open });
    } catch (e) {
      console.error("beavers-mobile-pawn | table could not use a door", e);
      reply({ error: "table-error" });
    }
  }

  /** Why this user may not use that door now, or undefined if they may. */
  private checkDoor(msg: DoorMessage): string | undefined {
    const scene = canvas?.ready ? canvas.scene : undefined;
    if (!scene) return "no-scene";
    const user = game.users.get(msg.userId);
    if (!user || typeof msg.wallId !== "string" || typeof msg.open !== "boolean") return "table-error";
    // The same rules as Foundry's own door control.
    if (!user.can("WALL_DOORS")) return "not-allowed";
    if (game.paused && !user.isGM) return "paused";
    const actor = game.actors.get(msg.actorId);
    if (actor && !actor.testUserPermission(user, "OWNER")) return "not-owner";
    const token = findToken(scene, msg.actorId);
    if (!token) return "no-token";
    // Scan again: the token may have moved, or something else now stands between it and the door.
    const reachable = scanAround(scene, token).some((a) => a.door.id === msg.wallId);
    if (!reachable) return "out-of-reach";
    if (scene.walls.get(msg.wallId)?.ds === CONST.WALL_DOOR_STATES.LOCKED) return "locked";
    return undefined;
  }

  private onClear(msg: ClearMessage) {
    this.remove(msg.userId);
  }

  private remove(userId: string) {
    const e = this.entries.get(userId);
    if (!e) return;
    clearTimeout(e.timer);
    e.gfx.destroy();
    e.label.destroy();
    this.entries.delete(userId);
  }

  private entry(userId: string): Entry {
    let e = this.entries.get(userId);
    if (!e) {
      const gfx = new PIXI.Graphics();
      const label = new PIXI.Text("", { fontSize: 28, fill: 0xffffff, stroke: 0x000000, strokeThickness: 5 });
      label.anchor.set(0.5, 1.4);
      this.container.addChild(gfx, label);
      e = { gfx, label };
      this.entries.set(userId, e);
    }
    clearTimeout(e.timer);
    e.timer = window.setTimeout(() => this.remove(userId), STALE_MS);
    return e;
  }

  private draw(
    userId: string,
    full: Path,
    allowed: Path,
    centerOf: (c: Cell) => { x: number; y: number },
    cell: number,
    user: any,
    scene: any,
  ) {
    if (!this.container) return;
    const { gfx, label } = this.entry(userId);
    const color = Number(user.color) || 0xffffff;
    const width = Math.max(4, cell / 8);
    gfx.clear();

    // the part the walls forbid, shown so the player sees where the cut happened
    if (allowed.length < full.length) {
      const from = centerOf(allowed[allowed.length - 1]);
      gfx.lineStyle(width / 2, 0xff3333, 0.35);
      gfx.moveTo(from.x, from.y);
      for (const c of full.slice(allowed.length)) {
        const p = centerOf(c);
        gfx.lineTo(p.x, p.y);
      }
    }

    const start = centerOf(allowed[0]);
    gfx.lineStyle(width, color, 0.5);
    gfx.moveTo(start.x, start.y);
    for (const c of allowed.slice(1)) {
      const p = centerOf(c);
      gfx.lineTo(p.x, p.y);
    }

    const end = centerOf(allowed[allowed.length - 1]);
    gfx.lineStyle(width / 2, 0xffffff, 0.6);
    gfx.beginFill(color, 0.4);
    gfx.drawCircle(end.x, end.y, cell / 3);
    gfx.endFill();

    const steps = stepCount(allowed);
    label.text = steps ? `${steps * scene.grid.distance} ${scene.grid.units ?? ""}`.trim() : "";
    label.position.set(end.x, end.y);
  }
}
