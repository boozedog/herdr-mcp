import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  getCallerContext,
  isToolResult,
  promptTarget,
  requireHerdr,
  resolveTarget,
  successResult,
  workflowOrError,
} from "../context.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";

export const ReadArgs = Schema.Struct({
  pane_id: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  lines: Schema.optional(Schema.Number),
});

export type ReadInput = typeof ReadArgs.Type;

export async function handleRead(
  ctx: ServerContext,
  input: ReadInput,
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

  const target = promptTarget(resolved);
  const lines = input.lines ?? workflow.defaults.read_lines;
  const transcript = await ctx.herdr.agentRead(target, lines);

  return successResult({
    pane_id: resolved.pane_id,
    target,
    lines,
    transcript,
  });
}

export const ReadInputSchema = toMcpInputSchema(ReadArgs);
