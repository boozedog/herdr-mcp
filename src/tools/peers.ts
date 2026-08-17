import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  fetchWorkspaceData,
  isToolResult,
  requireHerdr,
  successResult,
  workflowOrError,
} from "../context.ts";
import { detectRole } from "../pairing.ts";

export async function handlePeers(ctx: ServerContext): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const data = await fetchWorkspaceData(ctx, ids.workspace_id);
  if (isToolResult(data)) return data;

  const rows = data.panes.map((pane) => {
    const tab = data.tabs.find((t) => t.tab_id === pane.tab_id);
    return {
      label: tab?.label ?? "unknown",
      tab_id: pane.tab_id,
      pane_id: pane.pane_id,
      agent_name: pane.name ?? pane.agent ?? null,
      agent_status: pane.agent_status,
      cwd: pane.cwd ?? null,
      role: tab ? detectRole(tab.label, workflow.roles).role_id : "unknown",
    };
  });

  return successResult({ workspace_id: ids.workspace_id, peers: rows });
}
