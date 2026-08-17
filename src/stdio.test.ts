import { assertEquals, assertExists } from "@std/assert";

const DENO = Deno.execPath();
const MAIN = new URL("./main.ts", import.meta.url).pathname;

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

Deno.test("stdio: lists whoami and returns not_in_herdr without HERDR_ENV", async () => {
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
    const init = await read();
    assertEquals(init.id, 1);
    assertExists(init.result);

    await write({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    await write({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const listed = await read();
    const tools = (listed.result as { tools: { name: string }[] }).tools;
    assertEquals(tools.some((tool) => tool.name === "whoami"), true);

    await write({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    const called = await read();
    const result = called.result as {
      isError?: boolean;
      structuredContent?: { _tag?: string };
    };
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent?._tag, "not_in_herdr");

    await write({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {},
    });
    const stillListed = await read();
    assertEquals(stillListed.id, 4);
    assertExists(stillListed.result);
  });
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

      await write({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      await write({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      });
      const called = await read();
      const result = called.result as {
        isError?: boolean;
        structuredContent?: {
          workspace_id?: string;
          tab_id?: string;
          pane_id?: string;
        };
      };
      assertEquals(result.isError, undefined);
      assertEquals(result.structuredContent, {
        workspace_id: "wQ",
        tab_id: "wQ:t2",
        pane_id: "wQ:p2",
      });
    },
  );
});
