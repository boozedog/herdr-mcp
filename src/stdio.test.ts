import { assertEquals, assertExists } from "@std/assert";
import { dirname, join } from "@std/path";

const DENO = Deno.execPath();
const MAIN = new URL("./main.ts", import.meta.url).pathname;
const FIXTURES = join(dirname(new URL(import.meta.url).pathname), "../test/fixtures");

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message) + "\n";
}

async function readMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<JsonRpcMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream closed before message");
    buffer += decoder.decode(value);
    const index = buffer.indexOf("\n");
    if (index === -1) continue;
    const line = buffer.slice(0, index).trim();
    if (!line) {
      buffer = buffer.slice(index + 1);
      continue;
    }
    return JSON.parse(line) as JsonRpcMessage;
  }
}

async function withStdioServer(
  env: Record<string, string>,
  run: (io: {
    write: (message: JsonRpcMessage) => Promise<void>;
    read: () => Promise<JsonRpcMessage>;
    kill: () => void;
  }) => Promise<void>,
): Promise<void> {
  const cmd = new Deno.Command(DENO, {
    args: ["run", "-A", MAIN],
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      ...env,
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();
  const encoder = new TextEncoder();

  try {
    await run({
      write: async (message) => {
        await writer.write(encoder.encode(serializeMessage(message)));
      },
      read: () => readMessage(reader),
      kill: () => child.kill("SIGTERM"),
    });
  } finally {
    try {
      await writer.close();
    } catch {
      // already closed
    }
    child.kill("SIGTERM");
    await child.status.catch(() => null);
  }
}

async function initAndList(env: Record<string, string>) {
  const tools: string[] = [];
  await withStdioServer(env, async ({ write, read }) => {
    await write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "herdr-mcp-test", version: "0.0.0" },
      },
    });
    await read();
    await write({ jsonrpc: "2.0", method: "notifications/initialized" });
    await write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await read();
    const list = (listed.result as { tools: { name: string }[] }).tools;
    tools.push(...list.map((t) => t.name));
  });
  return tools;
}

Deno.test("stdio: lists preset tools without HERDR_ENV", async () => {
  const tools = await initAndList({});
  for (const name of [
    "whoami",
    "workflow",
    "peers",
    "handoff",
    "pane_read",
    "pane_run",
    "research_to_impl",
    "impl_to_review",
    "review_to_impl",
  ]) {
    assertEquals(tools.includes(name), true, `missing ${name}`);
  }
  assertEquals(tools.includes("read"), false);
  assertEquals(tools.includes("wait"), false);
  assertEquals(tools.includes("agent_read"), false);
  assertEquals(tools.includes("agent_wait"), false);
});

Deno.test("stdio: two-role fixture lists plan_to_do only", async () => {
  const tools = await initAndList({
    HERDR_MCP_CONFIG: join(FIXTURES, "two-role.toml"),
  });
  assertEquals(tools.includes("plan_to_do"), true);
  assertEquals(tools.includes("research_to_impl"), false);
});

Deno.test("stdio: bad config lists base tools only", async () => {
  const tools = await initAndList({
    HERDR_MCP_CONFIG: join(FIXTURES, "bad-config.toml"),
  });
  assertEquals(tools.includes("whoami"), true);
  assertEquals(tools.includes("research_to_impl"), false);
});

Deno.test("stdio: every tool returns not_in_herdr without HERDR_ENV", async () => {
  const toolNames = [
    "whoami",
    "workflow",
    "peers",
    "handoff",
    "pane_read",
    "pane_run",
    "research_to_impl",
  ];
  await withStdioServer({}, async ({ write, read }) => {
    await write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "herdr-mcp-test", version: "0.0.0" },
      },
    });
    await read();
    await write({ jsonrpc: "2.0", method: "notifications/initialized" });

    let id = 2;
    for (const name of toolNames) {
      await write({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: name === "handoff" || name.includes("_to_")
            ? { message: "test" }
            : name === "pane_read"
            ? { pane_id: "wQ:p1" }
            : name === "pane_run"
            ? { pane_id: "wQ:p1", command: "ls" }
            : {},
        },
      });
      const called = await read();
      assertEquals(called.id, id, `wrong id for ${name}`);
      if (called.error) {
        throw new Error(`${name} jsonrpc error: ${JSON.stringify(called.error)}`);
      }
      const result = called.result as {
        isError?: boolean;
        structuredContent?: { _tag?: string };
        content?: { type: string; text: string }[];
      };
      assertEquals(result.isError, true, `${name}: ${JSON.stringify(result)}`);
      const tag = result.structuredContent?._tag ??
        (result.content?.[0]?.text ? JSON.parse(result.content[0].text)._tag : undefined);
      assertEquals(tag, "not_in_herdr", name);
      id++;
    }
  });
});

Deno.test("stdio: bad config returns invalid_config when HERDR_ENV set", async () => {
  await withStdioServer(
    {
      HERDR_MCP_CONFIG: join(FIXTURES, "bad-config.toml"),
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "wQ",
      HERDR_TAB_ID: "wQ:t2",
      HERDR_PANE_ID: "wQ:p2",
    },
    async ({ write, read }) => {
      await write({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "herdr-mcp-test", version: "0.0.0" },
        },
      });
      await read();
      await write({ jsonrpc: "2.0", method: "notifications/initialized" });
      await write({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      });
      const called = await read();
      const result = called.result as {
        structuredContent?: { _tag?: string; path?: string };
      };
      assertEquals(result.structuredContent?._tag, "invalid_config");
      assertExists(result.structuredContent?.path);
    },
  );
});

Deno.test("stdio: whoami succeeds when HERDR_ENV and pane ids are set", async () => {
  await withStdioServer(
    {
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "wQ",
      HERDR_TAB_ID: "wQ:t2",
      HERDR_PANE_ID: "wQ:p2",
    },
    async ({ write, read }) => {
      await write({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "herdr-mcp-test", version: "0.0.0" },
        },
      });
      await read();
      await write({ jsonrpc: "2.0", method: "notifications/initialized" });
      await write({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      });
      const called = await read();
      const result = called.result as {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
      };
      // Live herdr may succeed or fail parse; at minimum not not_in_herdr
      assertEquals(result.structuredContent?._tag, undefined);
      assertEquals(result.structuredContent?.workspace_id, "wQ");
    },
  );
});
