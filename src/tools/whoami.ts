import type { ServerContext, ToolResult } from "../context.ts";
import {
  buildWhoamiEdges,
  effectiveEdgePair,
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  successResult,
  workflowOrError,
} from "../context.ts";

export async function handleWhoami(ctx: ServerContext): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const callerCtx = await getCallerContext(ctx, ids, workflow);
  if (isToolResult(callerCtx)) return callerCtx;

  const { caller, tabLabel, tabs, panes } = callerCtx;

  return successResult({
    workspace_id: ids.workspace_id,
    tab_id: ids.tab_id,
    tab_label: tabLabel,
    pane_id: ids.pane_id,
    role: caller.role_id,
    mutate: caller.mutate,
    suffix: caller.suffix,
    edges: buildWhoamiEdges(workflow, caller, tabs, panes),
  });
}

export function handleWorkflow(ctx: ServerContext): ToolResult {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  return successResult({
    name: workflow.name,
    config_path: workflow.config_path,
    defaults: workflow.defaults,
    pairing: workflow.pairing,
    roles: workflow.roles.map((r) => ({ id: r.id, mutate: r.mutate })),
    edges: workflow.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      tool: e.tool ?? false,
      pair: effectiveEdgePair(e),
      ...(e.round !== undefined ? { round: e.round } : {}),
    })),
  });
}
