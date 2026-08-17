import { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { notInHerdrError, NotInHerdr } from "./errors.ts";
import { isInHerdr, readHerdrEnvIds, type HerdrEnvIds } from "./herdr-env.ts";
import { NoArgs, toMcpInputSchema } from "./mcp-schema.ts";

export type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
};

export function encodeNotInHerdr(error: NotInHerdr): Record<string, unknown> {
  return Schema.encodeUnknownSync(NotInHerdr)(error);
}

export function notInHerdrResult(error: NotInHerdr = notInHerdrError()): ToolResult {
  const structured = encodeNotInHerdr(error);
  return {
    isError: true,
    content: [{ type: "text", text: error.message }],
    structuredContent: structured,
  };
}

export function whoamiSuccess(ids: HerdrEnvIds): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(ids) }],
    structuredContent: ids,
  };
}

export function handleWhoami(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): ToolResult {
  if (!isInHerdr(env)) return notInHerdrResult();
  const ids = readHerdrEnvIds(env);
  if (!ids) {
    return notInHerdrResult(
      new NotInHerdr({
        message: "HERDR_ENV=1 but Herdr pane ids are missing from the environment.",
      }),
    );
  }
  return whoamiSuccess(ids);
}

/** Register tools on an MCP server instance. */
export function registerHerdrTools(
  server: McpServer,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): void {
  const guard = <T>(handler: () => T | Promise<T>): (() => Promise<T | ToolResult>) =>
    async () => {
      if (!isInHerdr(env)) return notInHerdrResult();
      return await handler();
    };

  server.registerTool(
    "whoami",
    {
      description: "Return the current Herdr workspace, tab, and pane ids.",
      inputSchema: toMcpInputSchema(NoArgs),
    },
    guard(() => handleWhoami(env)),
  );
}

/** Build the herdr-mcp stdio server. */
export function createHerdrMcpServer(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): McpServer {
  const server = new McpServer(
    { name: "herdr-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerHerdrTools(server, env);
  return server;
}

export const TOOL_NAMES = ["whoami"] as const;
