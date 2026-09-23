/** What the GM can assign to a user. "auto" leaves the decision to the device (see resolveRole). */
export const USER_ROLES = ["auto", "phone", "table", "off"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface Assignment {
  role: UserRole;
  /** Actors this user may pick on the phone. Empty: everything the user owns. */
  actors: string[];
}
export type Assignments = Record<string, Assignment>;

/** Settings come from JSON the GM (or an older module version) wrote, so never trust the shape. */
export function normalizeAssignments(raw: unknown): Assignments {
  const out: Assignments = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [userId, value] of Object.entries(raw as Record<string, any>)) {
    if (!value || typeof value !== "object") continue;
    const role: UserRole = USER_ROLES.includes(value.role) ? value.role : "auto";
    const actors: string[] = Array.isArray(value.actors)
      ? [...new Set<string>(value.actors.filter((a: unknown): a is string => typeof a === "string"))]
      : [];
    if (role === "auto" && !actors.length) continue;
    out[userId] = { role, actors };
  }
  return out;
}

/** The GM's explicit list wins, the fallback (what the user owns) applies when there is none. Deleted actors drop out. */
export function chooseActorIds(assigned: string[], fallback: string[], exists: (id: string) => boolean): string[] {
  const valid = (ids: string[]) => [...new Set(ids)].filter(exists);
  const explicit = valid(assigned);
  return explicit.length ? explicit : valid(fallback);
}

/** Keep the remembered actor if it is still allowed, otherwise the first one. */
export function pickActor(ids: string[], preferred?: string): string | undefined {
  return preferred && ids.includes(preferred) ? preferred : ids[0];
}
