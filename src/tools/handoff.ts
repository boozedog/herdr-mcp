import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  resolveTarget,
  submitHandoff,
  workflowOrError,
} from "../context.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";

export const HandoffArgs = Schema.Struct({
  message: Schema.String,
  edge: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  pane_id: Schema.optional(Schema.String),
  allow_interrupt: Schema.optional(Schema.Boolean),
});

export type HandoffInput = typeof HandoffArgs.Type;

export async function handleHandoff(
  ctx: ServerContext,
  input: HandoffInput,
): Promise<ToolResult> {
  const workflow = workflowOrError(ctx);
  if (isToolResult(workflow)) return workflow;

  const ids = requireHerdr(ctx);
  if (isToolResult(ids)) return ids;

  const callerCtx = await getCallerContext(ctx, ids, workflow);
  if (isToolResult(callerCtx)) return callerCtx;

  const resolved = resolveTarget(
    workflow,
    callerCtx.caller,
    callerCtx.tabs,
    callerCtx.panes,
    ids.workspace_id,
    input,
  );
  if ("_tag" in resolved) return errorResult(resolved);

  return submitHandoff(
    ctx,
    resolved,
    input.message,
    input.allow_interrupt ?? false,
  );
}

export const HandoffInputSchema = toMcpInputSchema(HandoffArgs);
