import { McpServer } from "@modelcontextprotocol/server";
import {
  createServerContext,
  errorResult,
  isToolResult,
  requireHerdr,
  type ServerContext,
  type ToolResult,
  workflowOrError,
} from "./context.ts";
import { notInHerdrError, HerdrBinError } from "./errors.ts";
import { isInHerdr } from "./herdr-env.ts";
import type { HerdrClient } from "./herdr/client.ts";
import { NoArgs, toMcpInputSchema } from "./mcp-schema.ts";
import {
  DirectionalInput,
  buildDirectionalInputSchema,
  handleDirectionalEdge,
} from "./tools/directional.ts";
import { HandoffInputSchema, handleHandoff, type HandoffInput } from "./tools/handoff.ts";
import { handlePeers } from "./tools/peers.ts";
import {
  PaneReadInputSchema,
  handlePaneRead,
  type PaneReadInput,
} from "./tools/pane_read.ts";
import {
  PaneRunInputSchema,
  handlePaneRun,
  type PaneRunInput,
} from "./tools/pane_run.ts";
import { handleWhoami, handleWorkflow } from "./tools/whoami.ts";
import { generateInstructions } from "./workflow/instructions.ts";
import type { WorkflowLoadResult } from "./workflow/loader.ts";

const BASE_TOOLS = [
  "whoami",
  "workflow",
  "peers",
  "handoff",
  "pane_read",
  "pane_run",
] as const;

export type HerdrMcpOptions = {
  env?: Record<string, string | undefined>;
  herdr?: HerdrClient;
  cwd?: string;
  workflowResult?: WorkflowLoadResult;
};

function guardNoArgs(
  ctx: ServerContext,
  handler: () => Promise<ToolResult> | ToolResult,
): () => Promise<ToolResult> {
  return async () => {
    if (!isInHerdr(ctx.env)) return errorResult(notInHerdrError());
    const workflow = workflowOrError(ctx);
    if (isToolResult(workflow)) return workflow;
    const ids = requireHerdr(ctx);
    if (isToolResult(ids)) return ids;
    try {
      return await handler();
    } catch (error) {
      if (error instanceof HerdrBinError) return errorResult(error);
      throw error;
    }
  };
}

function guardTool<T>(
  ctx: ServerContext,
  handler: (args: T) => Promise<ToolResult> | ToolResult,
): (args: unknown) => Promise<ToolResult> {
  return async (args) => {
    if (!isInHerdr(ctx.env)) return errorResult(notInHerdrError());
    const workflow = workflowOrError(ctx);
    if (isToolResult(workflow)) return workflow;
    const ids = requireHerdr(ctx);
    if (isToolResult(ids)) return ids;
    try {
      return await handler(args as T);
    } catch (error) {
      if (error instanceof HerdrBinError) return errorResult(error);
      throw error;
    }
  };
}

/** Compute tool names for a workflow load result. */
export function computeToolNames(result: WorkflowLoadResult): string[] {
  const names: string[] = [...BASE_TOOLS];
  if (result.ok) {
    for (const edge of result.workflow.edges) {
      if (edge.tool) names.push(edge.id);
    }
  }
  return names;
}

/** Register tools on an MCP server instance. */
export function registerHerdrTools(
  server: McpServer,
  options: HerdrMcpOptions = {},
  existingCtx?: ServerContext,
): string[] {
  const ctx = existingCtx ?? createServerContext(
    options.env ?? Deno.env.toObject(),
    options.herdr,
    options.cwd,
  );
  if (options.workflowResult) {
    ctx.workflowResult = options.workflowResult;
  }

  const toolNames = computeToolNames(ctx.workflowResult);

  server.registerTool(
    "whoami",
    {
      description: "Return workspace/tab/pane ids, role, mutate flag, and available edges.",
      inputSchema: toMcpInputSchema(NoArgs),
    },
    guardNoArgs(ctx, () => handleWhoami(ctx)),
  );

  server.registerTool(
    "workflow",
    {
      description: "Dump the loaded workflow (name, roles, edges, config path).",
      inputSchema: toMcpInputSchema(NoArgs),
    },
    guardNoArgs(ctx, () => handleWorkflow(ctx)),
  );

  server.registerTool(
    "peers",
    {
      description: "List tabs and panes in the current HERDR_WORKSPACE_ID only.",
      inputSchema: toMcpInputSchema(NoArgs),
    },
    guardNoArgs(ctx, () => handlePeers(ctx)),
  );

  server.registerTool(
    "handoff",
    {
      description: "Submit a handoff message (fire-and-forget with confirmation). Does not wait.",
      inputSchema: HandoffInputSchema,
    },
    guardTool<HandoffInput>(ctx, (args) => handleHandoff(ctx, args)),
  );

  server.registerTool(
    "pane_read",
    {
      description:
        "Read any pane snapshot in the current workspace, including non-agent shells (fish, logs, git).",
      inputSchema: PaneReadInputSchema,
    },
    guardTool<PaneReadInput>(ctx, (args) => handlePaneRead(ctx, args)),
  );

  server.registerTool(
    "pane_run",
    {
      description:
        "Submit a command to a non-agent shell pane (fish, git, logs). Refuses agent panes with agent_pane — use handoff or a directional tool instead. Pair with pane_read to inspect output.",
      inputSchema: PaneRunInputSchema,
    },
    guardTool<PaneRunInput>(ctx, (args) => handlePaneRun(ctx, args)),
  );

  if (ctx.workflowResult.ok) {
    for (const edge of ctx.workflowResult.workflow.edges) {
      if (!edge.tool) continue;
      const edgeCopy = { ...edge };
      server.registerTool(
        edge.id,
        {
          description: `Directional handoff from ${edge.from} to ${edge.to}.`,
          inputSchema: buildDirectionalInputSchema(edge),
        },
        guardTool<DirectionalInput>(ctx, (args) => handleDirectionalEdge(ctx, edgeCopy, args)),
      );
    }
  }

  return toolNames;
}

/** Build the herdr-mcp stdio server. */
export function createHerdrMcpServer(options: HerdrMcpOptions = {}): McpServer {
  const ctx = createServerContext(
    options.env ?? Deno.env.toObject(),
    options.herdr,
    options.cwd,
  );
  if (options.workflowResult) {
    ctx.workflowResult = options.workflowResult;
  }

  const server = new McpServer(
    { name: "herdr-mcp", version: "0.3.0" },
    {
      capabilities: { tools: {} },
      instructions: generateInstructions(ctx.workflowResult),
    },
  );
  registerHerdrTools(server, options, ctx);
  return server;
}

export const TOOL_NAMES = BASE_TOOLS;
