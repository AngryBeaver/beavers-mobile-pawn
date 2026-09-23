import { clipPath, sanitizePath, stepCount, type Cell, type Path } from "../core/path.js";
import {
  SOCKET_NAME,
  type ClearMessage,
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
    // v14: getCenterPoint() honours token shape and elevation (walls can be elevation bound). v13 fallback below.
    const c0 = token.getCenterPoint?.() ?? {
      x: token.x + (token.width * cell) / 2,
      y: token.y + (token.height * cell) / 2,
    };
    const centerOf = ([dx, dy]: Cell) => ({ x: c0.x + dx * cell, y: c0.y + dy * cell, elevation: c0.elevation ?? token.elevation });

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

  /** The phone turns the token itself (it owns it), it only needs to know which one is on this scene. */
  private onLocate(msg: LocateMessage) {
    const scene = canvas?.ready ? canvas.scene : undefined;
    const token = scene && findToken(scene, msg.actorId);
    game.socket.emit(SOCKET_NAME, {
      type: "located",
      to: msg.userId,
      actorId: msg.actorId,
      ok: !!token,
      error: scene ? (token ? undefined : "no-token") : "no-scene",
      sceneId: scene?.id,
      tokenId: token?.id,
    });
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
