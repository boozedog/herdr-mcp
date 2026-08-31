import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  resolvePaneTarget,
  successResult,
  workflowOrError,
} from "../context.ts";
import { AgentPane, ParseFailed } from "../errors.ts";
import type { HerdrPane } from "../herdr/client.ts";
import { extractHerdrCliError, parsePromptOutput, type AgentStatus } from "../parse.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";

const AGENT_STATUSES = new Set<AgentStatus>(["idle", "working", "blocked", "done"]);

function agentPaneName(pane: HerdrPane): string | undefined {
  const name = pane.agent ?? pane.name;
  return name && name.length > 0 ? name : undefined;
}

export function isAgentPane(pane: HerdrPane): boolean {
  if (agentPaneName(pane) !== undefined) return true;
  return AGENT_STATUSES.has(pane.agent_status);
}

export const PaneRunArgs = Schema.Struct({
  pane_id: Schema.optional(Schema.String),
  tab_label: Schema.optional(Schema.String),
  command: Schema.String,
});

export type PaneRunInput = typeof PaneRunArgs.Type;

export async function handlePaneRun(
  ctx: ServerContext,
  input: PaneRunInput,
): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const callerCtx = await getCallerContext(ctx, ids, workflow);
  if (isToolResult(callerCtx)) return callerCtx;

  const resolved = resolvePaneTarget(
    input,
    ids.workspace_id,
    callerCtx.tabs,
    callerCtx.panes,
  );
  if ("_tag" in resolved) return errorResult(resolved);

  const pane = callerCtx.panes.find((p) => p.pane_id === resolved.pane_id);
  const tab = callerCtx.tabs.find((t) => t.tab_id === resolved.tab_id);
  const tabLabel = tab?.label ?? "unknown";

  if (pane && isAgentPane(pane)) {
    return errorResult(new AgentPane({
      message: "Target pane hosts a coding agent. Use handoff or a directional tool instead of pane_run.",
      pane_id: resolved.pane_id,
      tab_label: tabLabel,
      agent_name: agentPaneName(pane),
      agent_status: pane.agent_status,
    }));
  }

  const run = await ctx.herdr.paneRun(resolved.pane_id, input.command);
  const parsed = parsePromptOutput(run.stdout, run.exitCode);
  if (parsed.kind === "error") return errorResult(parsed.error);

  const accepted = parsed.kind === "accepted" ||
    (parsed.kind === "json" && extractHerdrCliError(parsed.value) === undefined);
  if (!accepted) {
    return errorResult(new ParseFailed({
      message: "herdr pane run was not accepted",
      stdout: run.stdout.slice(0, 500),
    }));
  }

  return successResult({
    pane_id: resolved.pane_id,
    tab_id: resolved.tab_id,
    tab_label: tabLabel,
    command: input.command,
    accepted,
    raw_stdout: run.stdout.slice(0, 500),
  });
}

export const PaneRunInputSchema = toMcpInputSchema(PaneRunArgs);
