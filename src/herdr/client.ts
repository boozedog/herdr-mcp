import type { AgentStatus } from "../parse.ts";
import { HerdrBinError } from "../errors.ts";

export type HerdrTab = {
  tab_id: string;
  workspace_id: string;
  label: string;
  agent_status?: AgentStatus;
  focused?: boolean;
  number?: number;
  pane_count?: number;
};

export type HerdrPane = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  agent?: string;
  agent_status: AgentStatus;
  cwd?: string;
  revision?: number;
  state_change_seq?: number;
  name?: string;
};

export type PromptSubmitResult = {
  accepted: boolean;
  raw_stdout: string;
  parsed?: unknown;
};

export type WaitResult = {
  agent_status: AgentStatus;
  raw_stdout: string;
  parsed?: unknown;
  stalled?: boolean;
  timed_out?: boolean;
};

export type PaneReadSource = "recent-unwrapped" | "recent" | "visible";

export interface HerdrClient {
  tabList(workspaceId: string): Promise<string>;
  paneList(workspaceId: string): Promise<string>;
  agentGet(target: string): Promise<string>;
  paneGet(target: string): Promise<string>;
  agentPrompt(target: string, text: string): Promise<{ stdout: string; exitCode: number }>;
  agentWait(target: string, timeoutMs: number): Promise<{ stdout: string; exitCode: number }>;
  agentRead(target: string, lines: number): Promise<string>;
  paneRead(target: string, lines: number, source: PaneReadSource): Promise<string>;
}

export type HerdrCommandRunner = (
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = Deno.statSync(path);
    if (!stat.isFile) return false;
    return (stat.mode! & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Resolve argv0 for herdr CLI subprocesses. */
export function resolveHerdrBinPath(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): { path: string } | { error: HerdrBinError } {
  const configured = env.HERDR_BIN_PATH?.trim();
  if (!configured) {
    return { path: "herdr" };
  }
  if (!isAbsolutePath(configured)) {
    return {
      error: new HerdrBinError({
        message: "HERDR_BIN_PATH must be a non-empty absolute path",
        path: configured,
      }),
    };
  }
  if (!isExecutableFile(configured)) {
    return {
      error: new HerdrBinError({
        message: `HERDR_BIN_PATH is missing or not executable: ${configured}`,
        path: configured,
      }),
    };
  }
  return { path: configured };
}

export function createDefaultRunner(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): HerdrCommandRunner {
  const resolved = resolveHerdrBinPath(env);
  if ("error" in resolved) {
    return async () => {
      throw resolved.error;
    };
  }
  const binPath = resolved.path;
  return async (args) => {
    const cmd = new Deno.Command(binPath, {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    return {
      stdout: stdout || stderr,
      stderr,
      exitCode: output.code,
    };
  };
}

export function createCliHerdrClient(
  runner: HerdrCommandRunner = createDefaultRunner(),
): HerdrClient {
  return {
    tabList(workspaceId) {
      return runner(["tab", "list", "--workspace", workspaceId]).then((r) => r.stdout);
    },
    paneList(workspaceId) {
      return runner(["pane", "list", "--workspace", workspaceId]).then((r) => r.stdout);
    },
    agentGet(target) {
      return runner(["agent", "get", target]).then((r) => r.stdout);
    },
    paneGet(target) {
      return runner(["pane", "get", target]).then((r) => r.stdout);
    },
    async agentPrompt(target, text) {
      const r = await runner(["agent", "prompt", target, text]);
      return { stdout: r.stdout, exitCode: r.exitCode };
    },
    async agentWait(target, timeoutMs) {
      const r = await runner(["agent", "wait", target, "--timeout", String(timeoutMs)]);
      return { stdout: r.stdout, exitCode: r.exitCode };
    },
    agentRead(target, lines) {
      return runner([
        "agent",
        "read",
        target,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(lines),
      ]).then((r) => r.stdout);
    },
    paneRead(target, lines, source) {
      return runner([
        "pane",
        "read",
        target,
        "--source",
        source,
        "--lines",
        String(lines),
      ]).then((r) => r.stdout);
    },
  };
}

/** In-memory mock for deterministic tests. */
export class MockHerdrClient implements HerdrClient {
  tabs: HerdrTab[] = [];
  panes: HerdrPane[] = [];
  prompts: { target: string; text: string }[] = [];
  promptResponses = new Map<string, { stdout: string; exitCode: number }>();
  waitResponses = new Map<string, { stdout: string; exitCode: number }>();
  readResponses = new Map<string, string>();
  paneReadResponses = new Map<string, string>();
  paneReadCalls: { target: string; lines: number; source: PaneReadSource }[] = [];
  agentGetResponses = new Map<string, string>();
  paneGetResponses = new Map<string, string>();
  failAgentGet = false;
  failPaneGet = false;

  tabList(workspaceId: string): Promise<string> {
    const tabs = this.tabs.filter((t) => t.workspace_id === workspaceId);
    return Promise.resolve(JSON.stringify({
      id: "cli:tab:list",
      result: { type: "tab_list", tabs },
    }));
  }

  paneList(workspaceId: string): Promise<string> {
    const panes = this.panes.filter((p) => p.workspace_id === workspaceId);
    return Promise.resolve(JSON.stringify({
      id: "cli:pane:list",
      result: { type: "pane_list", panes },
    }));
  }

  agentGet(target: string): Promise<string> {
    if (this.failAgentGet) return Promise.resolve("not json");
    const hit = this.agentGetResponses.get(target);
    if (hit) return Promise.resolve(hit);
    const pane = this.panes.find((p) => p.pane_id === target || p.name === target);
    if (!pane) {
      return Promise.resolve(JSON.stringify({
        id: "cli:agent:get",
        error: { message: "not found" },
      }));
    }
    return Promise.resolve(JSON.stringify({
      id: "cli:agent:get",
      result: {
        type: "agent_info",
        agent: {
          pane_id: pane.pane_id,
          tab_id: pane.tab_id,
          workspace_id: pane.workspace_id,
          agent: pane.agent,
          agent_status: pane.agent_status,
          revision: pane.revision,
          state_change_seq: pane.state_change_seq,
          name: pane.name,
          cwd: pane.cwd,
        },
      },
    }));
  }

  paneGet(target: string): Promise<string> {
    if (this.failPaneGet) return Promise.resolve("not json");
    const hit = this.paneGetResponses.get(target);
    if (hit) return Promise.resolve(hit);
    const pane = this.panes.find((p) => p.pane_id === target || p.name === target);
    if (!pane) {
      return Promise.resolve(JSON.stringify({
        id: "cli:pane:get",
        error: { message: "not found" },
      }));
    }
    return Promise.resolve(JSON.stringify({
      id: "cli:pane:get",
      result: {
        type: "pane_info",
        pane: {
          pane_id: pane.pane_id,
          tab_id: pane.tab_id,
          workspace_id: pane.workspace_id,
          agent: pane.agent,
          agent_status: pane.agent_status,
          revision: pane.revision,
          cwd: pane.cwd,
        },
      },
    }));
  }

  async agentPrompt(target: string, text: string): Promise<{ stdout: string; exitCode: number }> {
    this.prompts.push({ target, text });
    const hit = this.promptResponses.get(target);
    if (hit) return hit;
    return { stdout: '{"id":"cli:agent:prompt","result":{"accepted":true}}', exitCode: 0 };
  }

  async agentWait(target: string, timeoutMs: number): Promise<{ stdout: string; exitCode: number }> {
    const hit = this.waitResponses.get(target);
    if (hit) return hit;
    const pane = this.panes.find((p) => p.pane_id === target || p.name === target);
    const status = pane?.agent_status ?? "idle";
    return {
      stdout: JSON.stringify({
        id: "cli:agent:wait",
        result: { agent_status: status },
      }),
      exitCode: 0,
    };
  }

  agentRead(target: string, lines: number): Promise<string> {
    const hit = this.readResponses.get(target);
    if (hit) return Promise.resolve(hit);
    return Promise.resolve(`transcript for ${target} (${lines} lines)`);
  }

  paneRead(target: string, lines: number, source: PaneReadSource): Promise<string> {
    this.paneReadCalls.push({ target, lines, source });
    const hit = this.paneReadResponses.get(target);
    if (hit) return Promise.resolve(hit);
    return Promise.resolve(`pane transcript for ${target} (${lines} lines, ${source})`);
  }
}

export function parseTabList(stdout: string): HerdrTab[] {
  const parsed = JSON.parse(stdout) as { result?: { tabs?: HerdrTab[] } };
  return parsed.result?.tabs ?? [];
}

export function parsePaneList(stdout: string): HerdrPane[] {
  const parsed = JSON.parse(stdout) as { result?: { panes?: HerdrPane[] } };
  return parsed.result?.panes ?? [];
}
