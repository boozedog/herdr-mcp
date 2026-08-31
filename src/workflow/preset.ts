import type { WorkflowConfig } from "./schema.ts";

/** Built-in preset: research → impl → review (handoff edges) with final role for pairing. */
export const RESEARCH_IMPL_REVIEW_PRESET: WorkflowConfig = {
  preset: "research-impl-review",
  defaults: {
    timeout_ms: 600_000,
    read_lines: 120,
    busy_peer: "refuse",
    max_rounds: 5,
  },
  pairing: { strategy: "role-suffix" },
  roles: [
    { id: "research", match: "^research($|[0-9].*|-.*)", mutate: false },
    { id: "impl", match: "^impl($|[0-9].*|-.*)", mutate: true },
    { id: "review", match: "^review($|[0-9].*|-.*)", mutate: false },
    { id: "final", match: "^(final|codex)($|[0-9].*|-.*)", mutate: false },
  ],
  edges: [
    { id: "research_to_impl", from: "research", to: "impl", tool: true },
    { id: "impl_to_review", from: "impl", to: "review", tool: true, round: "submit" },
    { id: "review_to_impl", from: "review", to: "impl", tool: true, round: "respond" },
  ],
  envelope: {
    required: ["mission", "definition_of_done"],
  },
};

export const TWO_ROLE_FIXTURE: WorkflowConfig = {
  defaults: {
    timeout_ms: 600_000,
    read_lines: 120,
    busy_peer: "refuse",
    max_rounds: 5,
  },
  pairing: { strategy: "role-suffix" },
  roles: [
    { id: "plan", match: "^plan($|[0-9].*|-.*)", mutate: false },
    { id: "do", match: "^do($|[0-9].*|-.*)", mutate: true },
  ],
  edges: [
    { id: "plan_to_do", from: "plan", to: "do", tool: true },
  ],
};

export function normalizeWorkflow(config: WorkflowConfig, name: string, configPath: string | null) {
  return {
    name,
    config_path: configPath,
    defaults: {
      timeout_ms: config.defaults?.timeout_ms ?? 600_000,
      read_lines: config.defaults?.read_lines ?? 120,
      busy_peer: config.defaults?.busy_peer ?? "refuse" as const,
      max_rounds: config.defaults?.max_rounds ?? 5,
    },
    pairing: {
      strategy: config.pairing?.strategy ?? "role-suffix" as const,
    },
    roles: config.roles,
    edges: config.edges,
    envelope: config.envelope,
  };
}
