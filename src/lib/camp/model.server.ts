/**
 * Camp operations — the read model.
 *
 * One assembly that every screen reads: SoWork accounts joined to the
 * registry, with the derived facts (event role, account type, naming status,
 * duplicate flag, suggested name) computed from inputs + operator decisions.
 * Nothing derived is stored, so a corrected registry, a new role label or a
 * changed threshold re-derives everything on the next read.
 *
 * Cached in-process for a few seconds: the dashboard polls, and the whole
 * assembly is a dozen queries over a few hundred rows.
 */
import {
  findDuplicatePairs,
  matchAccounts,
  mergePersons,
  pairKey,
  type AccountMatch,
  type DuplicateDecision,
  type DuplicatePair,
  type LinkDecision,
  type RegistryPerson,
} from "./match";
import {
  buildRoleLabelIndex,
  checkNaming,
  parseDisplayName,
  roleFromName,
  suggestName,
  type ParsedName,
  type RoleLabelIndex,
} from "./naming";
import type { AccountType, CampSettings, EventRole } from "./settings";
import { loadSettings, q } from "./db.server";
import type { AccountRow, MatchState, RegistryRow, TeamRow, TypeChangeRow } from "./types";

export type ModelPerson = {
  key: string;
  registryId: string | null;
  accountIds: string[];
  name: string;
  role: EventRole;
  teamNo: number | null;
  guiderTeams: number[];
  phone: string | null;
  email: string | null;
};

export type DecisionRow = {
  pair_key: string;
  a_id: string;
  b_id: string;
  decision: "duplicate" | "not_duplicate" | "follow_up";
  primary_id: string | null;
  note: string | null;
  decided_by: string;
  decided_at: Date;
  decided_by_email: string | null;
};

export type CampModel = {
  settings: CampSettings;
  generatedAt: number;
  roles: RoleLabelIndex;
  accounts: AccountRow[];
  accountById: Map<string, AccountRow>;
  parsedById: Map<string, ParsedName>;
  registry: RegistryRow[];
  registryById: Map<string, RegistryRow>;
  teams: TeamRow[];
  persons: ModelPerson[];
  personByKey: Map<string, ModelPerson>;
  personOfAccount: Map<string, string>;
  pairs: DuplicatePair[];
  decisions: Map<string, DecisionRow>;
  typeChanges: TypeChangeRow[];
  matches: Map<string, AccountMatch>;
};

type SwUserDb = {
  sw_user_id: string;
  name: string;
  avatar_url: string | null;
  in_directory: boolean;
  wh_role: "admin" | "teammate" | null;
  presence: AccountRow["presence"];
  first_seen_at: Date;
  last_activity_at: Date | null;
};

type PersonDb = {
  id: string;
  kind: "participant" | "guider" | "coach";
  name: string;
  team_no: number | null;
  title: "leader" | "member" | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** BR-USR-01. */
export function accountTypeOf(u: { in_directory: boolean; wh_role: string | null }): AccountType {
  if (!u.in_directory) return "guest";
  return u.wh_role === "admin" ? "admin" : "teammate";
}

let cache: { at: number; model: Promise<CampModel> } | null = null;
const TTL_MS = 8_000;

export function invalidateCampModel(): void {
  cache = null;
}

export function loadCampModel(): Promise<CampModel> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.model;
  const model = buildModel();
  cache = { at: Date.now(), model };
  model.catch(() => {
    if (cache?.model === model) cache = null;
  });
  return model;
}

async function buildModel(): Promise<CampModel> {
  const settings = await loadSettings();
  const [
    users,
    people,
    guiderTeams,
    teams,
    links,
    decisions,
    reviews,
    changes,
    tracking,
    namingSends,
  ] = await Promise.all([
    q<SwUserDb>(
      `select sw_user_id, name, avatar_url, in_directory, wh_role, presence, first_seen_at, last_activity_at
         from public.camp_sw_users`,
    ),
    q<PersonDb>(
      `select id, kind, name, team_no, title, email, phone, notes from public.camp_people order by kind, team_no, member_order, name`,
    ),
    q<{ guider_id: string; team_no: number }>(
      `select guider_id, team_no from public.camp_guider_teams`,
    ),
    q<{
      team_no: number;
      application_no: string | null;
      guider_name: string | null;
      declared_members: number | null;
    }>(
      `select team_no, application_no, guider_name, declared_members from public.camp_teams order by team_no`,
    ),
    q<{ sw_user_id: string; status: LinkDecision["status"]; person_id: string | null }>(
      `select sw_user_id, status, person_id from public.camp_account_links`,
    ),
    q<DecisionRow>(
      `select d.*, u.email as decided_by_email from public.camp_dup_decisions d
         left join public.app_users u on u.id = d.decided_by`,
    ),
    q<{ sw_user_id: string }>(`select sw_user_id from public.camp_account_reviews`),
    q<{
      id: string;
      sw_user_id: string;
      kind: "type" | "remove";
      current_type: AccountType | null;
      requested_type: AccountType | null;
      reason: string;
      status: "pending" | "done" | "cancelled";
      requested_at: Date;
      done_at: Date | null;
    }>(`select * from public.camp_type_changes order by requested_at desc`),
    q<{ sw_user_id: string; first_violation_at: Date | null; fixed_at: Date | null }>(
      `select sw_user_id, first_violation_at, fixed_at from public.camp_name_tracking`,
    ),
    q<{ sw: string; at: Date }>(
      `select r as sw, max(created_at) as at from public.camp_send_log, unnest(recipients) as r
        where item_key in ('M01', 'M02', 'P04') and status in ('sent', 'partial') group by r`,
    ),
  ]);

  const roles = buildRoleLabelIndex(settings.roleLabels);
  const teamsOfGuider = new Map<string, number[]>();
  for (const g of guiderTeams)
    teamsOfGuider.set(g.guider_id, [...(teamsOfGuider.get(g.guider_id) ?? []), g.team_no]);
  const registryPeople: RegistryPerson[] = people.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    teamNo: p.team_no,
    phone: p.phone,
    email: p.email,
  }));
  const personDb = new Map(people.map((p) => [p.id, p]));

  const parsedById = new Map<string, ParsedName>();
  for (const u of users)
    parsedById.set(u.sw_user_id, parseDisplayName(u.name, roles, settings.honorifics));

  const linkDecisions = new Map<string, LinkDecision>();
  for (const l of links) {
    if (l.status === "linked" && l.person_id)
      linkDecisions.set(l.sw_user_id, { status: "linked", personId: l.person_id });
    else if (l.status === "not_in_registry")
      linkDecisions.set(l.sw_user_id, { status: "not_in_registry" });
    else if (l.status === "unlinked") linkDecisions.set(l.sw_user_id, { status: "unlinked" });
  }
  const matches = matchAccounts(
    users.map((u) => {
      const parsed = parsedById.get(u.sw_user_id)!;
      const fromName = roleFromName(parsed, settings.teamCount);
      return {
        swUserId: u.sw_user_id,
        coreTokens: parsed.coreTokens,
        nameTeamNo: fromName.teamNo,
        nameRole: parsed.role ?? parsed.inferredRole,
      };
    }),
    registryPeople,
    linkDecisions,
    { autoLinkScore: settings.autoLinkScore },
  );

  const dupDecisions: DuplicateDecision[] = decisions.map((d) => ({
    aId: d.a_id,
    bId: d.b_id,
    decision: d.decision,
    primaryId: d.primary_id,
  }));
  const { persons: merged, personOfAccount } = mergePersons(
    users.map((u) => u.sw_user_id),
    matches,
    dupDecisions,
    people.map((p) => p.id),
  );

  // Duplicate pairs over all accounts (FR-DUP-01..03).
  const pairs = findDuplicatePairs(
    users.map((u) => {
      const parsed = parsedById.get(u.sw_user_id)!;
      return {
        swUserId: u.sw_user_id,
        coreTokens: parsed.coreTokens,
        suffixKey: String(
          parsed.teamNo ?? parsed.role ?? parsed.inferredTeamNo ?? parsed.inferredRole ?? "",
        ),
        registryId: matches.get(u.sw_user_id)?.personId ?? null,
      };
    }),
    {
      suspectedScore: settings.duplicateSuspectedScore,
      lookalikeScore: settings.duplicateLookalikeScore,
    },
  );
  const decisionByKey = new Map(decisions.map((d) => [d.pair_key, d]));
  const rank = { confirmed: 0, suspected: 1, lookalike: 2 } as const;
  const openFlag = new Map<string, AccountRow["duplicate"]>();
  for (const pair of pairs) {
    const decision = decisionByKey.get(pair.key)?.decision;
    if (decision === "not_duplicate" || decision === "duplicate") continue;
    for (const id of [pair.aId, pair.bId]) {
      const current = openFlag.get(id);
      if (!current || rank[pair.level] < rank[current]) openFlag.set(id, pair.level);
    }
  }

  const guiderNamesOfTeam = new Map<number, string[]>();
  for (const g of guiderTeams) {
    const name = personDb.get(g.guider_id)?.name;
    if (name) guiderNamesOfTeam.set(g.team_no, [...(guiderNamesOfTeam.get(g.team_no) ?? []), name]);
  }
  const teamGuiderFallback = new Map(teams.map((t) => [t.team_no, t.guider_name]));
  const guiderOf = (teamNo: number | null) =>
    teamNo === null
      ? null
      : (guiderNamesOfTeam.get(teamNo)?.join("، ") ?? teamGuiderFallback.get(teamNo) ?? null);

  const reviewed = new Set(reviews.map((r) => r.sw_user_id));
  const pendingByAccount = new Map<string, AccountRow["pendingChange"]>();
  for (const c of changes) {
    if (c.status === "pending" && !pendingByAccount.has(c.sw_user_id)) {
      pendingByAccount.set(c.sw_user_id, {
        id: c.id,
        kind: c.kind,
        requestedType: c.requested_type,
      });
    }
  }
  const trackingById = new Map(tracking.map((t) => [t.sw_user_id, t]));
  const lastNamingMessage = new Map(namingSends.map((r) => [r.sw, r.at]));

  const accounts: AccountRow[] = users.map((u) => {
    const parsed = parsedById.get(u.sw_user_id)!;
    const match = matches.get(u.sw_user_id)!;
    const linked = match.personId ? personDb.get(match.personId) : undefined;
    const candidate = match.candidateId ? personDb.get(match.candidateId) : undefined;
    const fromName = roleFromName(parsed, settings.teamCount);
    // BR-USR-02/03: registry first, then the name suffix, else unknown.
    const eventRole: EventRole = linked ? linked.kind : fromName.role;
    const teamNo = linked
      ? linked.kind === "participant"
        ? linked.team_no
        : null
      : fromName.teamNo;
    const naming = checkNaming(
      parsed,
      {
        person: linked ? { kind: linked.kind, teamNo: linked.team_no } : null,
        bestScore: match.status === "not_in_registry" ? 0 : match.score,
      },
      { teamCount: settings.teamCount, honorifics: settings.honorifics },
    );
    const usedLabel = parsed.role ? parsed.suffix : undefined;
    const suggested =
      naming.status === "ok"
        ? null
        : linked
          ? suggestName(linked.name, eventRole, teamNo, settings.roleLabels, usedLabel)
          : eventRole !== "unknown" && parsed.personText
            ? suggestName(parsed.personText, eventRole, teamNo, settings.roleLabels, usedLabel)
            : null;
    const accountType = accountTypeOf(u);
    const expectedType = eventRole === "unknown" ? null : settings.expectedAccountTypes[eventRole];
    const matchState: MatchState =
      match.personId !== null
        ? "linked"
        : match.status === "candidate"
          ? "candidate"
          : "not_in_registry";
    const track = trackingById.get(u.sw_user_id);
    return {
      swUserId: u.sw_user_id,
      name: u.name,
      avatarUrl: u.avatar_url,
      namePart: parsed.namePart,
      suffix: parsed.suffix,
      suffixKind: parsed.suffixKind,
      eventRole,
      teamNo,
      guiderName: eventRole === "participant" ? guiderOf(teamNo) : null,
      accountType,
      expectedType,
      typeMismatch: !!expectedType && expectedType !== accountType,
      presence: u.presence,
      lastActivityAt: iso(u.last_activity_at),
      firstSeenAt: u.first_seen_at.toISOString(),
      phone: linked?.phone ?? null,
      email: linked?.email ?? null,
      registryId: linked?.id ?? null,
      registryName: linked?.name ?? null,
      candidateId: candidate?.id ?? null,
      candidateName: candidate?.name ?? null,
      matchStatus: match.status,
      matchState,
      matchScore: match.score,
      naming: naming.status,
      issues: naming.issues,
      suggestedName: suggested,
      duplicate: openFlag.get(u.sw_user_id) ?? null,
      personKey: personOfAccount.get(u.sw_user_id) ?? `u:${u.sw_user_id}`,
      reviewed: reviewed.has(u.sw_user_id),
      pendingChange: pendingByAccount.get(u.sw_user_id) ?? null,
      firstViolationAt: iso(track?.first_violation_at),
      nameFixedAt: iso(track?.fixed_at),
      lastNamingMessageAt: iso(lastNamingMessage.get(u.sw_user_id)),
    };
  });
  const accountById = new Map(accounts.map((a) => [a.swUserId, a]));

  const accountsOfRegistry = new Map<string, string[]>();
  for (const a of accounts) {
    if (a.registryId)
      accountsOfRegistry.set(a.registryId, [
        ...(accountsOfRegistry.get(a.registryId) ?? []),
        a.swUserId,
      ]);
  }
  const registry: RegistryRow[] = people.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    teamNo: p.team_no,
    title: p.title,
    email: p.email,
    phone: p.phone,
    notes: p.notes,
    guiderTeams: (teamsOfGuider.get(p.id) ?? []).sort((a, b) => a - b),
    accountIds: accountsOfRegistry.get(p.id) ?? [],
  }));
  const registryById = new Map(registry.map((r) => [r.id, r]));

  const persons: ModelPerson[] = merged.map((m) => {
    const reg = m.registryId ? registryById.get(m.registryId) : undefined;
    const primary = m.accountIds[0] ? accountById.get(m.accountIds[0]) : undefined;
    return {
      key: m.key,
      registryId: m.registryId,
      accountIds: m.accountIds,
      name: reg?.name ?? primary?.name ?? "",
      role: reg ? reg.kind : (primary?.eventRole ?? "unknown"),
      teamNo: reg ? reg.teamNo : (primary?.teamNo ?? null),
      guiderTeams: reg?.guiderTeams ?? [],
      phone: reg?.phone ?? null,
      email: reg?.email ?? null,
    };
  });

  const memberCount = new Map<number, number>();
  for (const r of registry)
    if (r.kind === "participant" && r.teamNo !== null)
      memberCount.set(r.teamNo, (memberCount.get(r.teamNo) ?? 0) + 1);

  return {
    settings,
    generatedAt: Date.now(),
    roles,
    accounts,
    accountById,
    parsedById,
    registry,
    registryById,
    teams: teams.map((t) => ({
      teamNo: t.team_no,
      applicationNo: t.application_no,
      guiderName: guiderOf(t.team_no),
      declaredMembers: t.declared_members,
      members: memberCount.get(t.team_no) ?? 0,
    })),
    persons,
    personByKey: new Map(persons.map((p) => [p.key, p])),
    personOfAccount,
    pairs,
    decisions: decisionByKey,
    typeChanges: changes.map((c) => ({
      id: c.id,
      swUserId: c.sw_user_id,
      name: accountById.get(c.sw_user_id)?.name ?? c.sw_user_id,
      kind: c.kind,
      currentType: c.current_type,
      requestedType: c.requested_type,
      reason: c.reason,
      status: c.status,
      requestedAt: c.requested_at.toISOString(),
      doneAt: iso(c.done_at),
    })),
    matches,
  };
}

export { pairKey };
