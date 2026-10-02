import { normalizeAssignments, USER_ROLES, type Assignments } from "../core/assignments.js";
import { SEATS, type Seat } from "../core/seat.js";
import { MODULE_ID } from "../core/protocol.js";
import { getAssignments, S } from "../settings.js";

const tr = (key: string) => game.i18n.localize(`beaversMobilePawn.assign.${key}`);
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * GM only. One row per user: the role of that user (phone, table screen, ...), which edge of the table screen
 * the user sits at, and which characters the user may control from the phone. Only characters the user owns are
 * offered, the table screen checks ownership too.
 */
export class AssignmentsApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "bmp-assignments",
    tag: "form",
    classes: ["bmp-assignments"],
    window: { title: "beaversMobilePawn.assign.title", icon: "fa-solid fa-mobile-screen", resizable: true },
    position: { width: 800, height: "auto" },
    form: { handler: AssignmentsApp.onSubmit, closeOnSubmit: true },
  };

  async _renderHTML(_context: unknown, _options: unknown): Promise<string> {
    const current = getAssignments();
    const users: any[] = [...game.users].sort((a, b) => a.name.localeCompare(b.name));
    const actors: any[] = [...game.actors].sort((a, b) => a.name.localeCompare(b.name));

    const rows = users.map((user) => {
      const cur = current[user.id] ?? { role: "auto", actors: [] };
      // GMs own everything, so for them "owned" would list the whole world: show player characters only.
      const offered = actors.filter(
        (a) => cur.actors.includes(a.id) || (user.isGM ? a.hasPlayerOwner : a.testUserPermission(user, "OWNER")),
      );
      // GMs are never phones (see resolveRole), so don't offer it
      const roles = USER_ROLES.filter((r) => !(user.isGM && r === "phone"))
        .map((r) => `<option value="${r}" ${r === cur.role ? "selected" : ""}>${esc(tr(`role.${r}`))}</option>`)
        .join("");
      const seat = cur.seat ?? "bottom";
      const seats = SEATS.map(
        (v) => `<option value="${v}" ${v === seat ? "selected" : ""}>${esc(tr(`seat.${v}`))}</option>`,
      ).join("");
      const boxes = offered.length
        ? offered
            .map((a) => {
              const owner = a.testUserPermission(user, "OWNER");
              return `<label class="bmp-chip ${owner ? "" : "bmp-chip-warn"}" title="${owner ? "" : esc(tr("notOwner"))}">
                <input type="checkbox" value="${a.id}" ${cur.actors.includes(a.id) ? "checked" : ""}>
                <span>${esc(a.name)}</span></label>`;
            })
            .join("")
        : `<span class="bmp-none">${esc(tr("noneOwned"))}</span>`;
      return `<tr data-user="${user.id}">
        <td class="bmp-user"><span class="bmp-dot" style="background:${esc(user.color)}"></span>${esc(user.name)}</td>
        <td><select class="bmp-role">${roles}</select></td>
        <td><select class="bmp-seat">${seats}</select></td>
        <td class="bmp-chips">${boxes}</td>
      </tr>`;
    });

    return `
      <p class="bmp-assign-hint">${esc(tr("hint"))}</p>
      <table class="bmp-assign-table">
        <thead><tr><th>${esc(tr("user"))}</th><th>${esc(tr("roleColumn"))}</th><th>${esc(tr("seatColumn"))}</th><th>${esc(tr("characters"))}</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <footer class="form-footer">
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(tr("save"))}</button>
      </footer>`;
  }

  _replaceHTML(result: string, content: HTMLElement, _options: unknown) {
    content.innerHTML = result;
  }

  static async onSubmit(this: AssignmentsApp, _event: Event, form: HTMLFormElement) {
    const out: Assignments = {};
    for (const row of Array.from(form.querySelectorAll<HTMLElement>("tr[data-user]"))) {
      const role = row.querySelector<HTMLSelectElement>("select.bmp-role")!.value as Assignments[string]["role"];
      const seat = row.querySelector<HTMLSelectElement>("select.bmp-seat")!.value as Seat;
      const actors = Array.from(row.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")).map(
        (i) => i.value,
      );
      out[row.dataset.user!] = { role, actors, seat };
    }
    await game.settings.set(MODULE_ID, S.ASSIGNMENTS, normalizeAssignments(out));
    ui.notifications.info(tr("saved"));
  }
}

export function registerAssignmentsMenu() {
  game.settings.registerMenu(MODULE_ID, "assignmentsMenu", {
    name: "beaversMobilePawn.assign.menuName",
    label: "beaversMobilePawn.assign.menuLabel",
    hint: "beaversMobilePawn.assign.menuHint",
    icon: "fa-solid fa-mobile-screen",
    type: AssignmentsApp,
    restricted: true,
  });
}
