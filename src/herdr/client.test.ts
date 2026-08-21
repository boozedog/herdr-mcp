import { assertEquals, assertRejects } from "@std/assert";
import { HerdrBinError } from "../errors.ts";
import {
  createCliHerdrClient,
  createDefaultRunner,
  resolveHerdrBinPath,
} from "./client.ts";

Deno.test("client: resolveHerdrBinPath uses herdr when unset", () => {
  assertEquals(resolveHerdrBinPath({}), { path: "herdr" });
});

Deno.test("client: resolveHerdrBinPath rejects non-absolute HERDR_BIN_PATH", () => {
  const result = resolveHerdrBinPath({ HERDR_BIN_PATH: "herdr" });
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertEquals(result.error._tag, "herdr_bin_error");
  }
});

Deno.test("client: createDefaultRunner uses herdr on PATH when unset", async () => {
  const seen: string[] = [];
  const runner = createDefaultRunner({});
  const client = createCliHerdrClient(async (args) => {
    seen.push("herdr");
    seen.push(...args);
    return { stdout: "ok", stderr: "", exitCode: 0 };
  });
  await client.tabList("wQ");
  assertEquals(seen[0], "herdr");
  assertEquals(seen.slice(1), ["tab", "list", "--workspace", "wQ"]);

  const defaultRunner = createDefaultRunner({});
  const captured: string[] = [];
  const originalCommand = Deno.Command;
  Deno.Command = class extends originalCommand {
    constructor(path: string | URL, options?: Deno.CommandOptions) {
      captured.push(String(path));
      super(path, options);
    }
  } as typeof Deno.Command;
  try {
    await defaultRunner(["tab", "list"]);
  } finally {
    Deno.Command = originalCommand;
  }
  assertEquals(captured[0], "herdr");
});

Deno.test("client: createDefaultRunner uses HERDR_BIN_PATH when set", async () => {
  const dir = await Deno.makeTempDir();
  const binPath = `${dir}/herdr-bin`;
  await Deno.writeTextFile(binPath, "#!/bin/sh\n");
  await Deno.chmod(binPath, 0o755);

  const captured: string[] = [];
  const originalCommand = Deno.Command;
  Deno.Command = class extends originalCommand {
    constructor(path: string | URL, options?: Deno.CommandOptions) {
      captured.push(String(path));
      super(path, options);
    }
  } as typeof Deno.Command;

  try {
    const runner = createDefaultRunner({ HERDR_BIN_PATH: binPath });
    await runner(["pane", "read", "wQ:p1", "--source", "recent-unwrapped", "--lines", "10"]);
    assertEquals(captured, [binPath]);
  } finally {
    Deno.Command = originalCommand;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("client: createDefaultRunner does not fall back when HERDR_BIN_PATH is bad", async () => {
  const runner = createDefaultRunner({ HERDR_BIN_PATH: "/no/such/herdr-binary" });
  await assertRejects(
    () => runner(["tab", "list"]),
    HerdrBinError,
  );

  const captured: string[] = [];
  const originalCommand = Deno.Command;
  Deno.Command = class extends originalCommand {
    constructor(path: string | URL, options?: Deno.CommandOptions) {
      captured.push(String(path));
      super(path, options);
    }
  } as typeof Deno.Command;
  try {
    await assertRejects(
      () => runner(["tab", "list"]),
      HerdrBinError,
    );
  } finally {
    Deno.Command = originalCommand;
  }
  assertEquals(captured.length, 0);
});

Deno.test("client: paneRead invokes pane read transport", async () => {
  const seen: string[] = [];
  const client = createCliHerdrClient(async (args) => {
    seen.push(...args);
    return { stdout: "pane text", stderr: "", exitCode: 0 };
  });
  const out = await client.paneRead("wQ:p9", 50, "visible");
  assertEquals(out, "pane text");
  assertEquals(seen, [
    "pane",
    "read",
    "wQ:p9",
    "--source",
    "visible",
    "--lines",
    "50",
  ]);
});
