import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  assertEdgeRole,
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  workflowOrError,
} from "../context.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";
import type { Edge } from "../workflow/schema.ts";
import type { HandoffInput } from "./handoff.ts";
import { handleHandoff } from "./handoff.ts";

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

  return handleHandoff(ctx, handoffInput);
}

export const DirectionalInputSchema = toMcpInputSchema(DirectionalArgs);
