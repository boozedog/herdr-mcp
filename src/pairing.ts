import type { EdgePairMode, Role } from "./workflow/schema.ts";

export type RoleMatch = {
  role_id: string;
  suffix: string;
  mutate: boolean;
};

const UNKNOWN_ROLE: RoleMatch = {
  role_id: "unknown",
  suffix: "",
  mutate: false,
};

/** Prefix labels for a role id (e.g. final also accepts codex). */
function rolePrefixes(role: Role): string[] {
  if (role.id === "final") return ["final", "codex"];
  return [role.id];
}

/** Extract suffix after the matched role prefix. */
export function extractSuffix(label: string, role: Role): string {
  for (const prefix of rolePrefixes(role)) {
    const re = new RegExp(`^${prefix}`, "i");
    if (re.test(label)) return label.replace(re, "");
  }
  return "";
}

/** Detect role and suffix from a tab label using configured roles. */
export function detectRole(label: string, roles: readonly Role[]): RoleMatch {
  for (const role of roles) {
    const re = new RegExp(role.match, "i");
    if (!re.test(label)) continue;
    return {
      role_id: role.id,
      suffix: extractSuffix(label, role),
      mutate: role.mutate,
    };
  }
  return UNKNOWN_ROLE;
}

/** Build the peer tab label for role-suffix pairing. */
export function peerLabelForRole(toRole: Role, suffix: string): string {
  return `${toRole.id}${suffix}`;
}

/** Find a tab label that matches the target role with the same suffix. */
export function findMatchingTabLabel(
  tabs: { label: string }[],
  toRole: Role,
  suffix: string,
): string | undefined {
  for (const tab of tabs) {
    const match = detectRole(tab.label, [toRole]);
    if (match.role_id === toRole.id && match.suffix === suffix) return tab.label;
  }
  return undefined;
}

/** Tab labels matching the target role for the given pair mode. */
export function findTabLabelsForPair(
  tabs: { label: string }[],
  toRole: Role,
  pair: EdgePairMode,
  callerSuffix: string,
): string[] {
  if (pair === "suffix") {
    const label = findMatchingTabLabel(tabs, toRole, callerSuffix);
    return label ? [label] : [];
  }
  return tabs
    .filter((tab) => {
      const match = detectRole(tab.label, [toRole]);
      return match.role_id === toRole.id && match.suffix === "";
    })
    .map((tab) => tab.label);
}

/** Impl-capable tab labels per #4. */
const IMPL_CAPABLE = [
  /^impl$/i,
  /^impl[0-9].*/i,
  /^impl-.+/i,
];

export function isImplCapableLabel(label: string): boolean {
  return IMPL_CAPABLE.some((re) => re.test(label));
}

/** Bare agent kinds must never be prompt targets. */
export const BARE_AGENT_KINDS = new Set(["grok", "cursor", "codex", "pi"]);

export function isBareAgentKind(target: string): boolean {
  return BARE_AGENT_KINDS.has(target.toLowerCase());
}
