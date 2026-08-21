import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  resolveByPaneId,
  successResult,
  workflowOrError,
} from "../context.ts";
import { AmbiguousTarget, UnknownTarget } from "../errors.ts";
import type { HerdrPane, PaneReadSource } from "../herdr/client.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";

const PaneReadSourceSchema = Schema.Union([
  Schema.Literal("recent-unwrapped"),
  Schema.Literal("recent"),
  Schema.Literal("visible"),
]);

export const PaneReadArgs = Schema.Struct({
  pane_id: Schema.optional(Schema.String),
  tab_label: Schema.optional(Schema.String),
  lines: Schema.optional(Schema.Number),
  source: Schema.optional(PaneReadSourceSchema),
});

export type PaneReadInput = typeof PaneReadArgs.Type;

function resolveByTabLabel(
  tabLabel: string,
  workspaceId: string,
  tabs: { tab_id: string; label: string; workspace_id: string }[],
  panes: HerdrPane[],
): HerdrPane | UnknownTarget | AmbiguousTarget {
  const tab = tabs.find((t) => t.workspace_id === workspaceId && t.label === tabLabel);
  if (!tab) {
    return new UnknownTarget({
      message: `No tab with label ${tabLabel} in workspace ${workspaceId}`,
      target: tabLabel,
    });
  }
  const tabPanes = panes.filter((p) => p.tab_id === tab.tab_id);
  if (tabPanes.length === 0) {
    return new UnknownTarget({
      message: `No panes found for tab ${tabLabel}`,
      target: tabLabel,
    });
  }
  if (tabPanes.length > 1) {
    return new AmbiguousTarget({
      message: `Tab ${tabLabel} has ${tabPanes.length} panes; provide pane_id`,
      tab_label: tabLabel,
      pane_ids: tabPanes.map((p) => p.pane_id),
    });
  }
  return tabPanes[0]!;
}

export async function handlePaneRead(
  ctx: ServerContext,
  input: PaneReadInput,
): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const hasPaneId = input.pane_id !== undefined && input.pane_id !== "";
  const hasTabLabel = input.tab_label !== undefined && input.tab_label !== "";
  if (hasPaneId === hasTabLabel) {
    return errorResult(new UnknownTarget({
      message: "Provide exactly one of pane_id or tab_label",
    }));
  }

  const callerCtx = await getCallerContext(ctx, ids, workflow);
  if (isToolResult(callerCtx)) return callerCtx;

  let resolved: HerdrPane | UnknownTarget | AmbiguousTarget;
  if (hasPaneId) {
    resolved = resolveByPaneId(input.pane_id!, ids.workspace_id, callerCtx.panes);
  } else {
    resolved = resolveByTabLabel(
      input.tab_label!,
      ids.workspace_id,
      callerCtx.tabs,
      callerCtx.panes,
    );
  }
  if ("_tag" in resolved) return errorResult(resolved);

  const tab = callerCtx.tabs.find((t) => t.tab_id === resolved.tab_id);
  const lines = input.lines ?? workflow.defaults.read_lines;
  const source: PaneReadSource = input.source ?? "recent-unwrapped";
  const transcript = await ctx.herdr.paneRead(resolved.pane_id, lines, source);

  return successResult({
    pane_id: resolved.pane_id,
    tab_id: resolved.tab_id,
    tab_label: tab?.label ?? "unknown",
    source,
    lines,
    transcript,
  });
}

export const PaneReadInputSchema = toMcpInputSchema(PaneReadArgs);
