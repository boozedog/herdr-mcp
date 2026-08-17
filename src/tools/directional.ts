import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  assertEdgeRole,
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  resolveTarget,
  successResult,
  workflowOrError,
} from "../context.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";
import type { Edge } from "../workflow/schema.ts";
import type { HandoffInput } from "./handoff.ts";
import { handleHandoff } from "./handoff.ts";
import { handleRead } from "./read.ts";
import { handleWait } from "./wait.ts";

export const DirectionalArgs = Schema.Struct({
  message: Schema.String,
  allow_interrupt: Schema.optional(Schema.Boolean),
});

export type DirectionalInput = typeof DirectionalArgs.Type;

export async function handleDirectionalEdge(
  ctx: ServerContext,
  edge: Edge,
  input: DirectionalInput,
): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const callerCtx = await getCallerContext(ctx, ids, workflow);
  if (isToolResult(callerCtx)) return callerCtx;

  const roleErr = assertEdgeRole(callerCtx.caller, edge);
  if (roleErr) return errorResult(roleErr);

  const handoffInput: HandoffInput = {
    message: input.message,
    edge: edge.id,
    allow_interrupt: input.allow_interrupt,
  };

  const handoffResult = await handleHandoff(ctx, handoffInput);
  if (handoffResult.isError) return handoffResult;

  if (!edge.wait) {
    return handoffResult;
  }

  const resolved = resolveTarget(
    workflow,
    callerCtx.caller,
    callerCtx.tabs,
    callerCtx.panes,
    ids.workspace_id,
    { edge: edge.id },
  );
  if ("_tag" in resolved) return errorResult(resolved);

  const waitResult = await handleWait(ctx, {
    pane_id: resolved.pane_id,
    timeout_ms: workflow.defaults.timeout_ms,
    baseline_revision: (handoffResult.structuredContent?.revision_after as number | undefined) ??
      (handoffResult.structuredContent?.revision_before as number | undefined),
    baseline_state_change_seq:
      (handoffResult.structuredContent?.state_change_seq_after as number | undefined) ??
      (handoffResult.structuredContent?.state_change_seq_before as number | undefined),
  });
  if (waitResult.isError) return waitResult;

  const readResult = await handleRead(ctx, {
    pane_id: resolved.pane_id,
    lines: workflow.defaults.read_lines,
  });
  if (readResult.isError) return readResult;

  return successResult({
    handoff: handoffResult.structuredContent,
    wait: waitResult.structuredContent,
    read: readResult.structuredContent,
  });
}

export const DirectionalInputSchema = toMcpInputSchema(DirectionalArgs);
