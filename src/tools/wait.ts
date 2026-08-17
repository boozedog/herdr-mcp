import { Schema } from "effect";
import { PromptStalled, ParseFailed } from "../errors.ts";
import type { ServerContext, ToolResult } from "../context.ts";
import {
  errorResult,
  getCallerContext,
  isToolResult,
  promptTarget,
  readStatus,
  requireHerdr,
  resolveTarget,
  successResult,
  workflowOrError,
} from "../context.ts";
import {
  extractHerdrCliError,
  parseStrictJson,
  snapshotFromHerdrResult,
  type AgentStatus,
  type StatusSnapshot,
} from "../parse.ts";
import { toMcpInputSchema } from "../mcp-schema.ts";

export const WaitArgs = Schema.Struct({
  pane_id: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  timeout_ms: Schema.optional(Schema.Number),
  baseline_revision: Schema.optional(Schema.Number),
  baseline_state_change_seq: Schema.optional(Schema.Number),
});

export type WaitInput = typeof WaitArgs.Type;

const STALL_MS = 5000;
const POLL_MS = 250;

function isNonWorking(status: AgentStatus): boolean {
  return status === "idle" || status === "done" || status === "unknown";
}

function sawLifecycleChange(
  before: StatusSnapshot,
  after: StatusSnapshot,
): boolean {
  if (before.agent_status !== after.agent_status) return true;
  if (
    before.revision !== undefined &&
    after.revision !== undefined &&
    after.revision !== before.revision
  ) return true;
  if (
    before.state_change_seq !== undefined &&
    after.state_change_seq !== undefined &&
    after.state_change_seq !== before.state_change_seq
  ) return true;
  return false;
}

async function pollForLifecycleChange(
  ctx: ServerContext,
  statusTarget: string,
  before: StatusSnapshot,
  deadlineMs: number,
): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const snap = await readStatus(ctx, statusTarget);
    if (isToolResult(snap)) continue;
    if (sawLifecycleChange(before, snap)) return true;
  }
  return false;
}

export async function handleWait(
  ctx: ServerContext,
  input: WaitInput,
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
  const statusTarget = resolved.pane_id;
  const timeoutMs = input.timeout_ms ?? workflow.defaults.timeout_ms;

  const initial = await readStatus(ctx, statusTarget);
  if (isToolResult(initial)) return initial;

  const baseline: StatusSnapshot = {
    agent_status: initial.agent_status,
    revision: input.baseline_revision ?? initial.revision,
    state_change_seq: input.baseline_state_change_seq ?? initial.state_change_seq,
  };

  if (isNonWorking(baseline.agent_status)) {
    const sawChange = await pollForLifecycleChange(
      ctx,
      statusTarget,
      baseline,
      Date.now() + STALL_MS,
    );
    if (!sawChange) {
      return errorResult(new PromptStalled({
        message: "No lifecycle change within 5s from a non-working state",
        pane_id: resolved.pane_id,
      }));
    }
  }

  const waitRun = await ctx.herdr.agentWait(target, timeoutMs);
  const parsed = parseStrictJson(waitRun.stdout);

  if (!parsed.ok) {
    if (waitRun.stdout.includes("agent_prompt_stalled") || waitRun.stdout.includes("stalled")) {
      return errorResult(new PromptStalled({
        message: "Agent wait stalled without lifecycle change",
        pane_id: resolved.pane_id,
      }));
    }
    return errorResult(parsed.error);
  }

  const cliError = extractHerdrCliError(parsed.value);
  if (cliError) {
    if (cliError.code === "agent_prompt_stalled" || cliError.code.includes("stalled")) {
      return errorResult(new PromptStalled({
        message: cliError.message,
        pane_id: resolved.pane_id,
      }));
    }
    if (cliError.code === "timeout") {
      return errorResult(new ParseFailed({
        message: `herdr agent wait timed out: ${cliError.message}`,
        stdout: waitRun.stdout.slice(0, 500),
      }));
    }
    return errorResult(new ParseFailed({
      message: `herdr agent wait failed: ${cliError.code}`,
      stdout: waitRun.stdout.slice(0, 500),
    }));
  }

  const snap = snapshotFromHerdrResult(parsed.value);
  const status = snap?.agent_status ?? "unknown";

  return successResult({
    pane_id: resolved.pane_id,
    target,
    agent_status: status,
    timed_out: false,
    stalled: false,
  });
}

export const WaitInputSchema = toMcpInputSchema(WaitArgs);
