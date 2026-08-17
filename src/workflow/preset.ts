import type { WorkflowConfig } from "./schema.ts";

/** Built-in preset: research → impl → review (handoff edges) with final role for pairing. */
export const RESEARCH_IMPL_REVIEW_PRESET: WorkflowConfig = {
  preset: "research-impl-review",
  defaults: {
    timeout_ms: 600_000,
    read_lines: 120,
    busy_peer: "refuse",
  },
  pairing: { strategy: "role-suffix" },
  roles: [
    { id: "research", match: "^research($|[0-9].*|-.*)", mutate: false },
    { id: "impl", match: "^impl($|[0-9].*|-.*)", mutate: true },
    { id: "review", match: "^review($|[0-9].*|-.*)", mutate: false },
    { id: "final", match: "^(final|codex)($|[0-9].*|-.*)", mutate: false },
  ],
  edges: [
    { id: "research_to_impl", from: "research", to: "impl", wait: false, tool: true },
    { id: "impl_to_review", from: "impl", to: "review", wait: true, tool: true },
    { id: "review_to_impl", from: "review", to: "impl", wait: false, tool: true },
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
  },
  pairing: { strategy: "role-suffix" },
  roles: [
    { id: "plan", match: "^plan($|[0-9].*|-.*)", mutate: false },
    { id: "do", match: "^do($|[0-9].*|-.*)", mutate: true },
  ],
  edges: [
    { id: "plan_to_do", from: "plan", to: "do", wait: false, tool: true },
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
    },
    pairing: {
      strategy: config.pairing?.strategy ?? "role-suffix" as const,
    },
    roles: config.roles,
    edges: config.edges,
    envelope: config.envelope,
  };
}
