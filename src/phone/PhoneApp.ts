import { pickActor } from "../core/assignments.js";
import { extendPathToward, ORIGIN, sanitizePath, stepCount, toWaypoints, type Cell, type Path } from "../core/path.js";
import {
  MODULE_ID,
  SOCKET_NAME,
  type LocatedMessage,
  type PathMessage,
  type PathResultMessage,
  type PawnMessage,
} from "../core/protocol.js";
import { angleToTable, toTable, type Seat } from "../core/seat.js";
import { getAssignments, getSetting, phoneActorIds, releaseCanvas, S, setExitedPhone } from "../settings.js";
import { keepScreenOn } from "./wakeLock.js";

const SEND_INTERVAL_MS = 60;
const RESULT_TIMEOUT_MS = 4000;
/** Longest gap between the first tap's release and the second touch that still counts as a double tap. */
const DOUBLE_TAP_MS = 350;
/** How far (in cells) the finger must leave the touched cell's centre before a press turns the token. */
const TURN_DEAD_ZONE = 0.5;
/** The pad always shows at least this many rows; on a short screen the cells shrink to fit them. */
const MIN_ROWS = 11;

type State = "idle" | "turning" | "dragging" | "pending" | "moving";

const t = (key: string, data?: Record<string, unknown>) =>
  data ? game.i18n.format(`beaversMobilePawn.phone.${key}`, data) : game.i18n.localize(`beaversMobilePawn.phone.${key}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Runs on the phone. A header (exit, character picker) above two swipeable pages: the character sheet
 * (not interactable) and a grid pad. Both pages always belong to the character chosen in the header.
 * The pad knows no map: the first touch is the actor's cell, the drag is a path of relative cells.
 * The table screen answers with the wall-clipped path.
 *
 * Gestures on the pad: double-tap the actor's cell and keep the finger down on the second tap to draw.
 * After release, a tap on the destination walks the token there, a double tap anywhere else cancels.
 * A single press that slides away from its cell turns the token toward the finger, live, without any path.
 *
 * The pad is drawn as the player sees it. A player sitting at another edge of the table screen (the GM sets the
 * seat) means something else by "up": paths and angles are turned into the table's orientation only when they
 * leave the phone (messages, token move, rotation), never for drawing.
 */
export class PhoneApp {
  private actors: any[] = [];
  private actor: any;
  private root!: HTMLElement;
  private pages!: HTMLElement;
  private sheetPage!: HTMLElement;
  private actorBtn!: HTMLButtonElement;
  private drawer!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private status!: HTMLElement;

  private minCols = 9; // the "grid columns" setting: never fewer across
  private cols = 9;
  private cellPx = 40;
  private rows = 12;

  private state: State = "idle";
  private start: Cell = [0, 0]; // pad cell of the first touch
  private path: Path = [ORIGIN]; // as the player sees it, see tablePath()
  private seat: Seat = "bottom"; // fixed per gesture, so a GM change mid-drag can't bend the path
  private seq = 0;
  private finalSeq = -1;
  private result?: PathResultMessage;
  private lastSend = 0;
  private sendTimer?: number;
  private resultTimer?: number;
  private downCell?: Cell; // pad cell of a touch that may still become a tap
  private lastTap?: { cell: Cell; time: number };
  private tapTimer?: number;
  private token?: any; // the actor's token on the table's scene, as far as the phone knows
  private turnAngle?: number; // screen direction from the touched cell to the finger, radians
  private turnSent?: number;
  private turnTimer?: number;

  start_() {
    this.minCols = getSetting<number>(S.PAD_COLUMNS);
    document.body.classList.add("bmp-phone");
    keepScreenOn();
    this.buildDom();
    game.socket.on(SOCKET_NAME, (msg: PawnMessage) => {
      if (msg.type === "result" && msg.to === game.user.id) this.onResult(msg);
      else if (msg.type === "located" && msg.to === game.user.id) this.onLocated(msg);
    });
    // The sheet renders itself into a Foundry window, move it into our page as soon as it exists.
    const onRender = (app: any) => {
      if (this.actor && app === this.actor.sheet) this.adoptSheet();
    };
    Hooks.on("renderActorSheet", onRender);
    Hooks.on("renderApplicationV2", onRender);
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.refreshActors(true);
  }

  /** (Re)read which characters this user may use, e.g. after the GM changed the assignments. */
  refreshActors(initial = false) {
    const ids = phoneActorIds();
    this.actors = ids.map((id) => game.actors.get(id)).filter(Boolean);
    const wanted = pickActor(ids, this.actor?.id ?? getSetting<string>(S.LAST_ACTOR));
    // initial: also when there is no character at all (wanted and current are both undefined), the page must say so
    if (initial || wanted !== this.actor?.id) void this.selectActor(wanted);
    else this.renderHeader();
  }

  // ---------------------------------------------------------------- DOM

  private buildDom() {
    this.root = document.createElement("div");
    this.root.id = "bmp-root";
    // Lets css/systems/<id>.css scope a fix to one game system only, e.g. #bmp-root.bmp-system-dnd5e.
    const systemId = String(game.system?.id ?? "").replace(/[^a-z0-9-]/gi, "");
    if (systemId) this.root.classList.add(`bmp-system-${systemId}`);
    this.root.innerHTML = `
      <header class="bmp-header">
        <button type="button" class="bmp-exit"><i class="fa-solid fa-xmark"></i></button>
        <button type="button" class="bmp-actor">
          <img class="bmp-avatar" alt="">
          <span class="bmp-actor-name"></span>
          <i class="fa-solid fa-chevron-down bmp-caret"></i>
        </button>
      </header>
      <div class="bmp-pages">
        <section class="bmp-page bmp-sheet-page"></section>
        <section class="bmp-page bmp-grid-page">
          <canvas class="bmp-pad"></canvas>
          <div class="bmp-status"></div>
        </section>
      </div>
      <nav class="bmp-tabs">
        <button type="button" data-page="0"><i class="fa-solid fa-scroll"></i><span></span></button>
        <button type="button" data-page="1"><i class="fa-solid fa-table-cells"></i><span></span></button>
      </nav>
      <div class="bmp-drawer" hidden>
        <div class="bmp-scrim"></div>
        <div class="bmp-panel"></div>
      </div>`;
    document.body.appendChild(this.root);

    this.pages = this.root.querySelector(".bmp-pages")!;
    this.sheetPage = this.root.querySelector(".bmp-sheet-page")!;
    // Elements with a tooltip take touches (css) so the tooltip can show on a press. Swallow everything that
    // would act on them before the sheet's own listeners see it: the sheet stays read-only, only the tabs work.
    for (const type of ["click", "dblclick", "auxclick", "contextmenu", "pointerdown", "mousedown", "dragstart"]) {
      this.sheetPage.addEventListener(
        type,
        (e) => {
          if ((e.target as Element | null)?.closest?.("nav.tabs")) return;
          e.stopPropagation();
          // pointerdown only has to stay away from the sheet's handlers; for the rest also cancel the browser's own
          // reaction (mousedown: focusing an input, which would pop up the keyboard; contextmenu: the long-press menu)
          if (type !== "pointerdown") e.preventDefault();
        },
        true,
      );
    }
    this.actorBtn = this.root.querySelector(".bmp-actor")!;
    this.drawer = this.root.querySelector(".bmp-drawer")!;
    this.canvasEl = this.root.querySelector(".bmp-pad")!;
    this.ctx = this.canvasEl.getContext("2d")!;
    this.status = this.root.querySelector(".bmp-status")!;
    this.root.querySelector(".bmp-exit")!.setAttribute("aria-label", t("exit"));

    const tabs = this.root.querySelectorAll<HTMLButtonElement>(".bmp-tabs button");
    tabs[0].querySelector("span")!.textContent = t("tabSheet");
    tabs[1].querySelector("span")!.textContent = t("tabGrid");
    tabs.forEach((b) =>
      b.addEventListener("click", () =>
        this.pages.scrollTo({ left: Number(b.dataset.page) * this.pages.clientWidth, behavior: "smooth" }),
      ),
    );
    this.pages.addEventListener("scroll", () => {
      const page = Math.round(this.pages.scrollLeft / Math.max(1, this.pages.clientWidth));
      tabs.forEach((b, i) => b.classList.toggle("active", i === page));
    });
    tabs[0].classList.add("active");

    this.root.querySelector(".bmp-exit")!.addEventListener("click", () => this.confirmExit());
    this.actorBtn.addEventListener("click", () => this.openPicker());
    this.drawer.querySelector(".bmp-scrim")!.addEventListener("click", () => this.closeDrawer());

    this.canvasEl.addEventListener("pointerdown", (e) => this.onDown(e));
    this.canvasEl.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvasEl.addEventListener("pointerup", (e) => this.onUp(e));
    this.canvasEl.addEventListener("pointercancel", (e) => this.onUp(e, true));
  }

  private resize() {
    const rect = this.canvasEl.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    // Square cells, as big as fit both minimums. Whichever side has room left over gets extra cells.
    this.cellPx = Math.max(1, Math.floor(Math.min(rect.width / this.minCols, rect.height / MIN_ROWS)));
    this.cols = Math.max(1, Math.floor(rect.width / this.cellPx));
    this.rows = Math.max(1, Math.floor(rect.height / this.cellPx));
    this.canvasEl.width = Math.round(rect.width * dpr);
    this.canvasEl.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private renderHeader() {
    const a = this.actor;
    this.actorBtn.querySelector<HTMLImageElement>(".bmp-avatar")!.src = a?.img ?? "";
    this.actorBtn.querySelector(".bmp-actor-name")!.textContent = a?.name ?? t("noCharacterShort");
    this.actorBtn.classList.toggle("bmp-empty", !a);
    this.actorBtn.classList.toggle("bmp-single", this.actors.length < 2);
    this.actorBtn.disabled = this.actors.length < 2;
  }

  // ------------------------------------------------------------- drawer

  private openDrawer(html: string): HTMLElement {
    const panel = this.drawer.querySelector<HTMLElement>(".bmp-panel")!;
    panel.innerHTML = html;
    this.drawer.hidden = false;
    return panel;
  }

  private closeDrawer() {
    this.drawer.hidden = true;
  }

  private openPicker() {
    const items = this.actors
      .map(
        (a) => `<button type="button" class="bmp-item ${a.id === this.actor?.id ? "current" : ""}" data-id="${a.id}">
          <img class="bmp-avatar" src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span>
          <i class="fa-solid fa-check"></i></button>`,
      )
      .join("");
    const panel = this.openDrawer(`<h2>${esc(t("chooseCharacter"))}</h2><div class="bmp-list">${items}</div>`);
    panel.querySelectorAll<HTMLElement>(".bmp-item").forEach((b) =>
      b.addEventListener("click", () => {
        this.closeDrawer();
        if (b.dataset.id !== this.actor?.id) void this.selectActor(b.dataset.id);
      }),
    );
  }

  private confirmExit() {
    const panel = this.openDrawer(`
      <h2>${esc(t("exitTitle"))}</h2>
      <p>${esc(t("exitText"))}</p>
      <div class="bmp-row">
        <button type="button" class="bmp-stay">${esc(t("exitStay"))}</button>
        <button type="button" class="bmp-leave">${esc(t("exitLeave"))}</button>
      </div>`);
    panel.querySelector(".bmp-stay")!.addEventListener("click", () => this.closeDrawer());
    panel.querySelector(".bmp-leave")!.addEventListener("click", () => void this.exit());
  }

  /** Back to the normal Foundry client: switch the canvas back on (phone mode had it off) and reload without phone mode. */
  private async exit() {
    if (this.state !== "idle") this.cancel();
    setExitedPhone(true);
    await releaseCanvas();
    const url = new URL(location.href);
    url.searchParams.delete("bmp"); // ?bmp=phone would switch straight back
    history.replaceState(null, "", url);
    location.reload();
  }

  // -------------------------------------------------------------- actor

  /** Make `id` the character of both pages: sheet and grid. */
  private async selectActor(id?: string) {
    if (this.state !== "idle") this.cancel();
    const prev = this.actor;
    this.actor = id ? game.actors.get(id) : undefined;
    this.token = undefined;
    this.renderHeader();
    this.sheetPage.replaceChildren();
    if (prev && prev !== this.actor) await prev.sheet?.close({ animate: false }).catch(() => {});
    if (!this.actor) {
      this.showNote(t("noCharacter"));
      return this.setStatus(t("noCharacter"));
    }
    game.settings.set(MODULE_ID, S.LAST_ACTOR, this.actor.id).catch(() => {});
    this.setStatus(t("hint"));
    try {
      await this.actor.sheet.render({ force: true });
    } catch (e) {
      console.error(`${MODULE_ID} | could not render the sheet`, e);
      return this.showNote(t("sheetFailed", { error: String((e as Error)?.message ?? e) }));
    }
    this.adoptSheet();
    if (!this.sheetPage.firstElementChild) {
      console.error(`${MODULE_ID} | the sheet rendered but has no element`, this.actor.sheet);
      this.showNote(t("sheetMissing"));
    }
  }

  private showNote(text: string) {
    const note = document.createElement("p");
    note.className = "bmp-note";
    note.textContent = text;
    this.sheetPage.replaceChildren(note);
  }

  /** Move Foundry's sheet window into our page, read-only via CSS. */
  private adoptSheet() {
    // v13+ gives a plain element, older applications a jQuery object. Never index an element: a <form> (which
    // actor sheets are) answers element[0] with its first input field.
    const raw = this.actor?.sheet?.element;
    const el: HTMLElement | undefined = raw instanceof HTMLElement ? raw : raw?.[0];
    if (el && el.parentElement !== this.sheetPage) {
      el.classList.add("bmp-sheet-window");
      this.sheetPage.replaceChildren(el);
    }
  }

  // ------------------------------------------------------------- pointer

  private cellAt(e: PointerEvent): Cell {
    const rect = this.canvasEl.getBoundingClientRect();
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((e.clientX - rect.left) / this.cellPx)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((e.clientY - rect.top) / this.cellPx)));
    return [cx, cy];
  }

  /** Same as cellAt, but the exact fractional position (cell N spans [N, N+1)), for the diagonal-biased
   * quantizer in extendPathToward - see the comment on nextStep for why this can't just floor per axis. */
  private rawCellAt(e: PointerEvent): [number, number] {
    const rect = this.canvasEl.getBoundingClientRect();
    const rx = Math.min(this.cols, Math.max(0, (e.clientX - rect.left) / this.cellPx));
    const ry = Math.min(this.rows, Math.max(0, (e.clientY - rect.top) / this.cellPx));
    return [rx - this.start[0], ry - this.start[1]];
  }

  private onDown(e: PointerEvent) {
    if (!this.actor || this.state === "turning" || this.state === "dragging" || this.state === "moving") return;
    const cell = this.cellAt(e);
    const tap = this.lastTap;
    const double = !!tap && performance.now() - tap.time < DOUBLE_TAP_MS;
    this.downCell = undefined;
    if (this.state === "idle" && double && sameCell(tap!.cell, cell)) return this.startDrag(e, cell);
    if (this.state === "pending" && double && !this.isDestination(cell)) {
      this.lastTap = undefined;
      return this.cancel();
    }
    this.downCell = cell; // decided on release: a tap only if the finger stays on this cell
    if (this.state === "idle") this.startTurn(e, cell);
  }

  /** A single press: nothing happens until the finger leaves the cell's centre, then the token faces the finger. */
  private startTurn(e: PointerEvent, cell: Cell) {
    this.canvasEl.setPointerCapture(e.pointerId);
    this.state = "turning";
    this.start = cell;
    this.seat = currentSeat();
    this.turnAngle = undefined;
    const msg = { type: "locate", userId: game.user.id, actorId: this.actor.id };
    game.socket.emit(SOCKET_NAME, msg);
    this.draw();
  }

  private turnToward(e: PointerEvent) {
    const rect = this.canvasEl.getBoundingClientRect();
    const [cx, cy] = this.px(this.start);
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;
    if (Math.hypot(dx, dy) < this.cellPx * TURN_DEAD_ZONE) return;
    this.turnAngle = Math.atan2(dy, dx);
    this.downCell = undefined; // this press turned, it is no tap any more
    this.sendTurn();
    this.draw();
  }

  /** Throttled like the path: at most one token update per interval, always ending with the latest angle. */
  private sendTurn() {
    if (this.turnTimer) return;
    const wait = Math.max(0, SEND_INTERVAL_MS - (performance.now() - (this.turnSent ?? 0)));
    this.turnTimer = window.setTimeout(() => {
      this.turnTimer = undefined;
      this.turnSent = performance.now();
      this.applyTurn();
    }, wait);
  }

  private applyTurn() {
    if (this.turnAngle === undefined || !this.token?.parent) return;
    // Foundry's rotation 0 faces down (token art looks south) and grows clockwise, screen angle 0 points right.
    const angle = angleToTable(this.turnAngle, this.seat);
    const rotation = Math.round((((angle * 180) / Math.PI - 90) % 360 + 360) % 360);
    if (this.token.rotation === rotation) return;
    this.token.update({ rotation }).catch((err: unknown) => console.warn(`${MODULE_ID} | could not turn the token`, err));
  }

  private onLocated(msg: LocatedMessage) {
    if (msg.actorId !== this.actor?.id) return;
    if (!msg.ok) {
      if (this.state === "turning") this.setStatus(t(`err.${msg.error}`));
      return;
    }
    this.token = game.scenes.get(msg.sceneId)?.tokens.get(msg.tokenId);
    if (!this.token) {
      if (this.state === "turning") this.setStatus(t("err.no-token"));
      return;
    }
    if (this.state === "turning") this.sendTurn();
  }

  /** Second touch of the double tap: the finger stays down and draws the path from here. */
  private startDrag(e: PointerEvent, cell: Cell) {
    this.canvasEl.setPointerCapture(e.pointerId);
    this.lastTap = undefined;
    clearTimeout(this.tapTimer);
    this.start = cell;
    this.path = [ORIGIN];
    this.seat = currentSeat();
    this.result = undefined;
    this.state = "dragging";
    this.finalSeq = -1;
    clearTimeout(this.resultTimer);
    this.setStatus(t("waiting"));
    this.send(false, true);
    this.draw();
  }

  private onMove(e: PointerEvent) {
    if (this.state === "turning") return this.turnToward(e);
    if (this.state !== "dragging") return;
    const [rx, ry] = this.rawCellAt(e);
    const next = extendPathToward(this.path, rx, ry, getSetting<number>(S.MAX_STEPS));
    if (next === this.path) return;
    this.path = next;
    this.send(false);
    this.draw();
  }

  private onUp(e: PointerEvent, cancelled = false) {
    if (this.state !== "dragging") return this.onTap(e, cancelled);
    if (cancelled || stepCount(this.path) === 0) return this.cancel();
    this.state = "pending";
    this.finalSeq = this.seq + 1;
    this.send(true, true);
    navigator.vibrate?.(15);
    this.setStatus(t("waiting"));
    this.resultTimer = window.setTimeout(() => {
      if (this.state === "pending" && this.result?.seq !== this.finalSeq) this.setStatus(t("noTable"));
    }, RESULT_TIMEOUT_MS);
    this.draw();
  }

  /** A touch that did not draw: on the destination it moves, anywhere else it may be the first half of a double tap. */
  private onTap(e: PointerEvent, cancelled: boolean) {
    if (this.state === "turning") {
      this.state = "idle";
      this.turnAngle = undefined;
      this.draw();
    }
    const cell = this.downCell;
    this.downCell = undefined;
    if (!cell || cancelled || !sameCell(cell, this.cellAt(e))) return;
    if (this.state === "pending" && this.isDestination(cell)) return void this.commit();
    this.lastTap = { cell, time: performance.now() };
    // mark the armed cell until the double tap window closes
    clearTimeout(this.tapTimer);
    this.tapTimer = window.setTimeout(() => {
      this.lastTap = undefined;
      this.draw();
    }, DOUBLE_TAP_MS);
    this.draw();
  }

  /** The table answered the final path and `cell` is where the walk ends (or where the finger was released). */
  private isDestination(cell: Cell): boolean {
    const r = this.result;
    if (this.state !== "pending" || !r?.ok || !r.allowed || r.allowed < 2 || r.seq < this.finalSeq) return false;
    const abs = ([x, y]: Cell): Cell => [x + this.start[0], y + this.start[1]];
    return sameCell(cell, abs(this.path[r.allowed - 1])) || sameCell(cell, abs(this.path.at(-1)!));
  }

  // ------------------------------------------------------------- network

  /** The drawn path turned from the player's seat into the table's orientation. Same cells, same order. */
  private tablePath(): Path {
    return this.path.map((c) => toTable(c, this.seat));
  }

  private send(final: boolean, immediate = false) {
    const fire = () => {
      this.sendTimer = undefined;
      this.lastSend = performance.now();
      const msg: PathMessage = {
        type: "path",
        userId: game.user.id,
        actorId: this.actor.id,
        seq: ++this.seq,
        final,
        steps: this.tablePath(),
      };
      game.socket.emit(SOCKET_NAME, msg);
    };
    if (final || immediate) {
      clearTimeout(this.sendTimer);
      return fire();
    }
    // throttle: at most one message per interval, always ending with the latest path
    if (this.sendTimer) return;
    const wait = Math.max(0, SEND_INTERVAL_MS - (performance.now() - this.lastSend));
    this.sendTimer = window.setTimeout(fire, wait);
  }

  private onResult(msg: PathResultMessage) {
    if (this.state !== "dragging" && this.state !== "pending") return;
    if (this.result && msg.seq < this.result.seq) return; // stale answer
    this.result = msg;
    if (msg.ok) this.token = game.scenes.get(msg.sceneId)?.tokens.get(msg.tokenId) ?? this.token;
    if (!msg.ok) {
      this.setStatus(t(`err.${msg.error}`));
    } else if (this.state === "pending" && msg.seq >= this.finalSeq) {
      const key = msg.distance ? "stepsDistance" : "steps";
      const info = t(key, { steps: (msg.allowed ?? 1) - 1, distance: msg.distance, units: msg.units ?? "" });
      const text = msg.blocked ? `${t("blocked")} ${info}` : info;
      this.setStatus(`${text} ${t((msg.allowed ?? 0) > 1 ? "confirmHint" : "cancelHint")}`);
    }
    this.draw();
  }

  private cancel() {
    clearTimeout(this.sendTimer);
    clearTimeout(this.resultTimer);
    this.sendTimer = undefined;
    game.socket.emit(SOCKET_NAME, { type: "clear", userId: game.user.id, moved: false });
    this.reset();
  }

  private reset() {
    this.state = "idle";
    this.path = [ORIGIN];
    this.result = undefined;
    this.setStatus(this.actor ? t("hint") : t("noCharacter"));
    this.draw();
  }

  /** Walk the token along the clipped path, one straight segment at a time. */
  private async commit() {
    const r = this.result;
    if (this.state !== "pending" || !r?.ok || !r.allowed || r.allowed < 2) return;
    const token = game.scenes.get(r.sceneId)?.tokens.get(r.tokenId);
    if (!token) return this.setStatus(t("err.no-token"));
    // Like Foundry itself: a paused game lets players turn but not move. Stay pending, the tap works once unpaused.
    if (game.paused && !game.user.isGM) return this.setStatus(t("paused"));

    this.state = "moving"; // ignore touches until the walk is done
    const walk = this.tablePath().slice(0, r.allowed);
    const way = toWaypoints(walk);
    const delay = getSetting<number>(S.STEP_DELAY);
    const at = (c: Cell) => ({ x: r.originX! + c[0] * r.cell!, y: r.originY! + c[1] * r.cell! });
    try {
      if (typeof token.move === "function") {
        // v14: one movement along all waypoints. The promise resolves when the animation on this client is done,
        // and this client has no canvas, so never wait longer than the walk should take.
        const cells = stepCount(walk);
        await Promise.race([token.move(way.slice(1).map(at)), sleep(cells * delay + 2000)]);
      } else {
        // v13: no movement API, chain plain updates segment by segment.
        for (let i = 1; i < way.length; i++) {
          const cells = Math.max(Math.abs(way[i][0] - way[i - 1][0]), Math.abs(way[i][1] - way[i - 1][1]));
          await token.update(at(way[i]));
          await sleep(cells * delay);
        }
      }
    } catch (e) {
      console.error(`${MODULE_ID} | move failed`, e);
    }
    game.socket.emit(SOCKET_NAME, { type: "clear", userId: game.user.id, moved: true });
    this.reset();
  }

  // ------------------------------------------------------------- drawing

  private setStatus(text: string) {
    this.status.textContent = text;
  }

  private px([cx, cy]: Cell) {
    return [(cx + 0.5) * this.cellPx, (cy + 0.5) * this.cellPx] as const;
  }

  private draw() {
    const { ctx, cellPx: c } = this;
    const w = this.cols * c;
    const h = this.rows * c;
    const css = getComputedStyle(this.root);
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

    ctx.strokeStyle = css.getPropertyValue("--bmp-grid").trim() || "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.cols; x++) {
      ctx.moveTo(x * c + 0.5, 0);
      ctx.lineTo(x * c + 0.5, h);
    }
    for (let y = 0; y <= this.rows; y++) {
      ctx.moveTo(0, y * c + 0.5);
      ctx.lineTo(w, y * c + 0.5);
    }
    ctx.stroke();

    // the table draws this user's paths in the user colour, so the pad does too
    const accent = userColor() || css.getPropertyValue("--bmp-accent").trim() || "#9b8cff";
    if (this.state === "turning") {
      // the touched cell, and once the finger left its centre a small arrow toward it
      const [tx, ty] = this.start;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = accent;
      ctx.fillRect(tx * c + 1, ty * c + 1, c - 1, c - 1);
      ctx.globalAlpha = 1;
      if (this.turnAngle === undefined) return;
      const [cx, cy] = this.px(this.start);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.turnAngle);
      ctx.beginPath();
      ctx.moveTo(c * 0.4, 0);
      ctx.lineTo(-c * 0.15, -c * 0.22);
      ctx.lineTo(-c * 0.05, 0);
      ctx.lineTo(-c * 0.15, c * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    if (this.state === "idle") {
      if (!this.lastTap) return;
      // first tap of the double tap: a second touch on this cell starts drawing
      const [tx, ty] = this.lastTap.cell;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = accent;
      ctx.fillRect(tx * c + 1, ty * c + 1, c - 1, c - 1);
      ctx.globalAlpha = 1;
      return;
    }
    const bad = css.getPropertyValue("--bmp-bad").trim() || "#ff6b6b";
    const abs = (p: Path) => p.map(([x, y]) => this.px([x + this.start[0], y + this.start[1]]));

    // Until the table answers, show the raw drag faintly. Afterwards the walkable part is solid and the
    // remainder the walls cut off is red.
    const cut = this.result?.ok ? Math.min(this.result.allowed ?? this.path.length, this.path.length) : this.path.length;
    const line = (pts: (readonly [number, number])[], color: string, alpha: number, width: number) => {
      if (pts.length < 2) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };
    line(abs(this.path.slice(cut - 1)), bad, 0.7, c / 6);
    line(abs(this.path.slice(0, cut)), accent, this.result?.ok ? 1 : 0.45, c / 4);
    ctx.globalAlpha = 1;

    const [sx, sy] = this.px(this.start);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(sx, sy, c / 4, 0, Math.PI * 2);
    ctx.fill();
    const end = abs(this.path.slice(0, cut)).at(-1)!;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(end[0], end[1], c / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** The user colour as CSS: a Color object (v12+), a hex string or a number, depending on the Foundry version. */
function userColor(): string | undefined {
  const c = game.user?.color;
  if (c === undefined || c === null || c === "") return undefined;
  if (typeof c === "string") return c;
  if (typeof c.css === "string") return c.css;
  const n = Number(c);
  return Number.isFinite(n) ? `#${n.toString(16).padStart(6, "0")}` : undefined;
}

const currentSeat = (): Seat => getAssignments()[game.user.id]?.seat ?? "bottom";

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

// Exposed for tests / console poking only.
export { sanitizePath };
