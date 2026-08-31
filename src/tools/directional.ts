import { Schema } from "effect";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  assertEdgeRole,
  errorResult,
  getCallerContext,
  isToolResult,
  requireHerdr,
  resolveTarget,
  submitHandoff,
  workflowOrError,
} from "../context.ts";
import { InvalidConfig, RoundCap } from "../errors.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";
import { commitSubmitRound, peekSubmitRound } from "../rounds.ts";
import type { Edge } from "../workflow/schema.ts";
import { PositiveInt } from "../workflow/schema.ts";
import type { HandoffInput } from "./handoff.ts";
import { handleHandoff } from "./handoff.ts";

const BaseDirectionalArgs = {
  message: Schema.String,
  allow_interrupt: Schema.optional(Schema.Boolean),
};

export const PlainDirectionalArgs = Schema.Struct({ ...BaseDirectionalArgs });
export type PlainDirectionalInput = typeof PlainDirectionalArgs.Type;

export const SubmitDirectionalArgs = Schema.Struct({
  ...BaseDirectionalArgs,
  reset: Schema.optional(Schema.Boolean),
  max_rounds: Schema.optional(PositiveInt),
});
export type SubmitDirectionalInput = typeof SubmitDirectionalArgs.Type;

export const ReviewStatus = Schema.Union([
  Schema.Literal("APPROVED"),
  Schema.Literal("CHANGES_REQUESTED"),
]);
export type ReviewStatus = typeof ReviewStatus.Type;

export const RespondDirectionalArgs = Schema.Struct({
  ...BaseDirectionalArgs,
  round: PositiveInt,
  status: ReviewStatus,
});
export type RespondDirectionalInput = typeof RespondDirectionalArgs.Type;

export type DirectionalInput =
  | PlainDirectionalInput
  | SubmitDirectionalInput
  | RespondDirectionalInput;

export function buildDirectionalArgs(edge: Edge) {
  if (edge.round === "submit") return SubmitDirectionalArgs;
  if (edge.round === "respond") return RespondDirectionalArgs;
  return PlainDirectionalArgs;
}

export function buildDirectionalInputSchema(edge: Edge) {
  return toMcpInputSchema(buildDirectionalArgs(edge));
}

function stampSubmitMessage(message: string, round: number, maxRounds: number): string {
  return `## Round ${round} / ${maxRounds}\n\n${message}`;
}

function stampRespondMessage(
  message: string,
  round: number,
  maxRounds: number,
  status: ReviewStatus,
): string {
  return `## Round ${round} / ${maxRounds}\n## Status ${status}\n\n${message}`;
}

function mergeHandoffResult(
  handoffResult: ToolResult,
  extra: Record<string, unknown>,
): ToolResult {
  if (handoffResult.isError || !handoffResult.structuredContent) return handoffResult;
  const merged = { ...handoffResult.structuredContent, ...extra };
  return {
    ...handoffResult,
    content: [{ type: "text", text: JSON.stringify(merged) }],
    structuredContent: merged,
  };
}

function shouldCommitSubmitRound(handoffResult: ToolResult): boolean {
  if (!handoffResult.isError) return true;
  return handoffResult.structuredContent?._tag === "confirmation_error";
}

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

  const configMaxRounds = workflow.defaults.max_rounds;

  if (edge.round === "submit") {
    const submitInput = input as SubmitDirectionalInput;
    const effectiveMax = submitInput.max_rounds ?? configMaxRounds;
    if (submitInput.max_rounds !== undefined && submitInput.max_rounds > configMaxRounds) {
      return errorResult(new InvalidConfig({
        message: `max_rounds ${submitInput.max_rounds} exceeds config cap ${configMaxRounds}`,
        path: workflow.config_path ?? workflow.name,
        schema_path: "max_rounds",
      }));
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

    const round = peekSubmitRound(
      ids.workspace_id,
      ids.pane_id,
      resolved.pane_id,
      edge.id,
      submitInput.reset ?? false,
    );

    if (round > effectiveMax) {
      return errorResult(new RoundCap({
        message: `Review round ${round} exceeds cap ${effectiveMax}`,
        round,
        max_rounds: effectiveMax,
        pane_id: resolved.pane_id,
      }));
    }

    const message = stampSubmitMessage(submitInput.message, round, effectiveMax);
    const handoffResult = await submitHandoff(
      ctx,
      resolved,
      message,
      submitInput.allow_interrupt ?? false,
    );
    if (shouldCommitSubmitRound(handoffResult)) {
      commitSubmitRound(
        ids.workspace_id,
        ids.pane_id,
        resolved.pane_id,
        edge.id,
        round,
      );
    }
    return mergeHandoffResult(handoffResult, { round, max_rounds: effectiveMax });
  }

  if (edge.round === "respond") {
    const respondInput = input as RespondDirectionalInput;
    const message = stampRespondMessage(
      respondInput.message,
      respondInput.round,
      configMaxRounds,
      respondInput.status,
    );
    const handoffInput: HandoffInput = {
      message,
      edge: edge.id,
      allow_interrupt: respondInput.allow_interrupt,
    };
    const handoffResult = await handleHandoff(ctx, handoffInput);
    return mergeHandoffResult(handoffResult, {
      round: respondInput.round,
      max_rounds: configMaxRounds,
      status: respondInput.status,
    });
  }

  const plainInput = input as PlainDirectionalInput;
  const handoffInput: HandoffInput = {
    message: plainInput.message,
    edge: edge.id,
    allow_interrupt: plainInput.allow_interrupt,
  };
  return handleHandoff(ctx, handoffInput);
}

/** @deprecated Use buildDirectionalInputSchema(edge) per edge. */
export const DirectionalInputSchema = toMcpInputSchema(PlainDirectionalArgs);
