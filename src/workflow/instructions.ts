import type { WorkflowLoadResult } from "./loader.ts";
import type { Edge, LoadedWorkflow } from "./schema.ts";

function toolEdges(workflow: LoadedWorkflow): Edge[] {
  return workflow.edges.filter((edge) => edge.tool);
}

function roleIds(workflow: LoadedWorkflow): string {
  return workflow.roles.map((role) => role.id).join(", ");
}

function edgeIds(edges: readonly Edge[]): string {
  return edges.map((edge) => edge.id).join(", ");
}

function hasReverseToolEdge(edges: readonly Edge[]): boolean {
  const forward = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
  return edges.some((edge) => forward.has(`${edge.to}\0${edge.from}`));
}

function fireAndForgetClause(directional: readonly Edge[], reverse: boolean): string {
  if (directional.length > 0) {
    const base = `Tools (${edgeIds(directional)}) and handoff are fire-and-forget — do not wait`;
    return reverse ? `${base}; reply on reverse edge.` : `${base}.`;
  }
  return "handoff is fire-and-forget — do not wait.";
}

function effectivePair(edge: Edge): "suffix" | "unsuffixed" {
  return edge.pair ?? "suffix";
}

function pairingClause(workflow: LoadedWorkflow): string | null {
  const toolEdgeList = toolEdges(workflow);
  if (toolEdgeList.length === 0) return null;
  const parts = toolEdgeList.map((edge) => `${edge.id} ${effectivePair(edge)}`);
  return `Pairing (${parts.join("; ")}). handoff { role } uses that pair when exactly one outbound edge targets the role; else suffix. Prefer edge or directional tools.`;
}

/** Build MCP initialize instructions from the loaded workflow. */
export function generateInstructions(result: WorkflowLoadResult): string {
  if (!result.ok) {
    return "herdr-mcp workflow config is invalid. Inside Herdr, every tool call returns invalid_config until the config is fixed.";
  }

  const workflow = result.workflow;
  const directional = toolEdges(workflow);
  const reverse = hasReverseToolEdge(directional);
  const sections: string[] = [];

  sections.push([
    "herdr-mcp coordinates Herdr panes.",
    "Call whoami before submit; use its edges.",
    `Roles: ${roleIds(workflow)}.`,
    fireAndForgetClause(directional, reverse),
    "Do not scrape agent TUIs for findings.",
    "No submit to working/blocked peers unless allow_interrupt.",
    "pane_read any pane; pane_run shells only (agent_pane — use handoff).",
    "mutate=false: no edits (advisory).",
    "Use peers and workflow before submit.",
    "No herdr CLI when connected.",
  ].join(" "));

  const submitEdges = directional.filter((edge) => edge.round === "submit");
  const respondEdges = directional.filter((edge) => edge.round === "respond");
  const roundParts: string[] = [];
  if (submitEdges.length > 0) {
    roundParts.push(
      `Round submit (${edgeIds(submitEdges)}): server assigns round; may return round_cap; optional reset.`,
    );
  }
  if (respondEdges.length > 0) {
    roundParts.push(
      `Round respond (${edgeIds(respondEdges)}): pass round and status (APPROVED or CHANGES_REQUESTED).`,
    );
  }
  if (roundParts.length > 0) {
    sections.push(roundParts.join(" "));
  }

  const pairing = pairingClause(workflow);
  if (pairing) {
    sections.push(pairing);
  }

  return sections.join("\n\n");
}
