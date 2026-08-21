import { assertEquals, assertExists } from "@std/assert";
import { createServerContext, resolveByPaneId, resolveTarget } from "./context.ts";
import { MockHerdrClient } from "./herdr/client.ts";
import { handleHandoff } from "./tools/handoff.ts";
import { handleWait } from "./tools/wait.ts";
import { handlePeers } from "./tools/peers.ts";
import { handleDirectionalEdge } from "./tools/directional.ts";
import { handlePaneRead } from "./tools/pane_read.ts";
import { handleRead } from "./tools/read.ts";
import { handleWhoami } from "./tools/whoami.ts";
import { computeToolNames } from "./server.ts";
import { loadWorkflowFromFile } from "./workflow/loader.ts";
import { normalizeWorkflow, RESEARCH_IMPL_REVIEW_PRESET, TWO_ROLE_FIXTURE } from "./workflow/preset.ts";

const FIXTURES_DIR = new URL("../test/fixtures/", import.meta.url);
const fixturePath = (name: string) => new URL(name, FIXTURES_DIR).pathname;

const HERDR_ENV = {
  HERDR_ENV: "1",
  HERDR_WORKSPACE_ID: "wQ",
  HERDR_TAB_ID: "wQ:t1",
  HERDR_PANE_ID: "wQ:p1",
};

function mockWorkspace() {
  const herdr = new MockHerdrClient();
  herdr.tabs = [
    { tab_id: "wQ:t1", workspace_id: "wQ", label: "research" },
    { tab_id: "wQ:t2", workspace_id: "wQ", label: "impl" },
    { tab_id: "wQ:t3", workspace_id: "wQ", label: "review" },
    { tab_id: "wX:t9", workspace_id: "wX", label: "foreign" },
  ];
  herdr.panes = [
    {
      pane_id: "wQ:p1",
      tab_id: "wQ:t1",
      workspace_id: "wQ",
      agent_status: "idle",
      revision: 1,
      state_change_seq: 1,
      name: "research",
    },
    {
      pane_id: "wQ:p2",
      tab_id: "wQ:t2",
      workspace_id: "wQ",
      agent_status: "idle",
      revision: 1,
      state_change_seq: 1,
      name: "impl",
    },
    {
      pane_id: "wQ:p3",
      tab_id: "wQ:t3",
      workspace_id: "wQ",
      agent_status: "idle",
      revision: 1,
      state_change_seq: 1,
      name: "review",
    },
    {
      pane_id: "wX:p9",
      tab_id: "wX:t9",
      workspace_id: "wX",
      agent_status: "idle",
      revision: 1,
    },
  ];
  return herdr;
}

Deno.test("tools: default preset tool names", () => {
  const names = computeToolNames({
    ok: true,
    workflow: normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null),
  });
  assertEquals(names.includes("whoami"), true);
  assertEquals(names.includes("workflow"), true);
  assertEquals(names.includes("research_to_impl"), true);
  assertEquals(names.includes("impl_to_review"), true);
  assertEquals(names.includes("review_to_impl"), true);
});

Deno.test("tools: two-role fixture tool names", () => {
  const result = loadWorkflowFromFile(fixturePath("two-role.toml"));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const names = computeToolNames(result);
  assertEquals(names.includes("plan_to_do"), true);
  assertEquals(names.includes("research_to_impl"), false);
});

Deno.test("tools: whoami returns role and edges", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleWhoami(ctx);
  assertEquals(result.isError, undefined);
  const data = result.structuredContent!;
  assertEquals(data.role, "research");
  assertEquals(data.mutate, false);
  assertEquals(data.suffix, "");
  const edges = data.edges as { id: string; paired_pane_id?: string }[];
  assertEquals(edges.some((e) => e.id === "research_to_impl"), true);
  assertEquals(edges.find((e) => e.id === "research_to_impl")?.paired_pane_id, "wQ:p2");
});

Deno.test("tools: foreign pane_id is unknown_target", () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const hit = resolveByPaneId("wX:p9", "wQ", herdr.panes);
  assertEquals("_tag" in hit && hit._tag === "unknown_target", true);
});

Deno.test("tools: busy_peer on blocked target", async () => {
  const herdr = mockWorkspace();
  herdr.panes.find((p) => p.pane_id === "wQ:p2")!.agent_status = "blocked";
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleHandoff(ctx, {
    message: "hello",
    role: "impl",
  });
  assertEquals(result.structuredContent?._tag, "busy_peer");
});

Deno.test("tools: handoff unknown edge", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleHandoff(ctx, {
    message: "hello",
    edge: "no_such_edge",
  });
  assertEquals(result.structuredContent?._tag, "unknown_edge");
});

Deno.test("tools: wait stalls from idle without lifecycle change", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleWait(ctx, {
    role: "impl",
    timeout_ms: 100,
  });
  assertEquals(result.structuredContent?._tag, "prompt_stalled");
});

Deno.test("tools: wait maps timeout JSON error", async () => {
  const herdr = mockWorkspace();
  herdr.waitResponses.set("impl", {
    stdout: '{"error":{"code":"timeout","message":"timed out"},"id":"cli:agent:wait"}',
    exitCode: 1,
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  // Seed working so stall gate is skipped
  herdr.panes.find((p) => p.pane_id === "wQ:p2")!.agent_status = "working";
  const result = await handleWait(ctx, { role: "impl", timeout_ms: 100 });
  assertEquals(result.structuredContent?._tag, "parse_failed");
});

Deno.test("tools: busy_peer on working target", async () => {
  const herdr = mockWorkspace();
  herdr.panes.find((p) => p.pane_id === "wQ:p2")!.agent_status = "working";
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t1", HERDR_PANE_ID: "wQ:p1" },
    herdr,
  );
  const result = await handleHandoff(ctx, {
    message: "hello",
    role: "impl",
  });
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent?._tag, "busy_peer");
});

Deno.test("tools: allow_interrupt overrides busy_peer", async () => {
  const herdr = mockWorkspace();
  herdr.panes.find((p) => p.pane_id === "wQ:p2")!.agent_status = "working";
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleHandoff(ctx, {
    message: "hello",
    role: "impl",
    allow_interrupt: true,
  });
  assertEquals(result.isError, undefined);
  assertEquals(herdr.prompts.length, 1);
});

Deno.test("tools: wrong_role on directional tool", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t1", HERDR_PANE_ID: "wQ:p1" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  const result = await handleDirectionalEdge(ctx, edge, { message: "review me" });
  assertEquals(result.structuredContent?._tag, "wrong_role");
});

Deno.test("tools: peers workspace scoped", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePeers(ctx);
  const peers = result.structuredContent?.peers as { pane_id: string }[];
  assertEquals(peers.length, 3);
  assertEquals(peers.some((p) => p.pane_id.startsWith("wX:")), false);
});

Deno.test("tools: suffix pairing research2 to impl2", () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t5", workspace_id: "wQ", label: "research2" });
  herdr.tabs.push({ tab_id: "wQ:t6", workspace_id: "wQ", label: "impl2" });
  herdr.panes.push({
    pane_id: "wQ:p5",
    tab_id: "wQ:t5",
    workspace_id: "wQ",
    agent_status: "idle",
  });
  herdr.panes.push({
    pane_id: "wQ:p6",
    tab_id: "wQ:t6",
    workspace_id: "wQ",
    agent_status: "idle",
    name: "impl2",
  });
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t5", HERDR_PANE_ID: "wQ:p5" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const caller = { role_id: "research", suffix: "2", mutate: false };
  const pane = resolveTarget(wf, caller, herdr.tabs, herdr.panes, "wQ", { role: "impl" });
  assertEquals("_tag" in pane, false);
  if (!("_tag" in pane)) assertEquals(pane.pane_id, "wQ:p6");
});

Deno.test("tools: status fallback noisy agent get", async () => {
  const herdr = mockWorkspace();
  herdr.failAgentGet = true;
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleHandoff(ctx, { message: "hi", role: "impl" });
  assertEquals(result.isError, undefined);
});

Deno.test("tools: confirm state_changed on revision bump", async () => {
  const herdr = mockWorkspace();
  const impl = herdr.panes.find((p) => p.pane_id === "wQ:p2")!;
  impl.revision = 5;
  impl.state_change_seq = 10;
  herdr.agentGetResponses.set("impl", JSON.stringify({
    result: {
      agent: {
        pane_id: "wQ:p2",
        agent_status: "idle",
        revision: 5,
        state_change_seq: 10,
        name: "impl",
      },
    },
  }));
  // After prompt, revision bumps
  let calls = 0;
  const origAgentGet = herdr.agentGet.bind(herdr);
  herdr.agentGet = (target: string) => {
    calls++;
    if (calls <= 1) {
      return origAgentGet(target);
    }
    return Promise.resolve(JSON.stringify({
      result: {
        agent: {
          pane_id: "wQ:p2",
          agent_status: "working",
          revision: 6,
          state_change_seq: 11,
          name: "impl",
        },
      },
    }));
  };
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleHandoff(ctx, { message: "go", role: "impl" });
  assertEquals(result.structuredContent?.state_changed, true);
});

Deno.test("tools: two-role whoami", async () => {
  const herdr = new MockHerdrClient();
  herdr.tabs = [
    { tab_id: "wQ:t1", workspace_id: "wQ", label: "plan" },
    { tab_id: "wQ:t2", workspace_id: "wQ", label: "do" },
  ];
  herdr.panes = [
    { pane_id: "wQ:p1", tab_id: "wQ:t1", workspace_id: "wQ", agent_status: "idle" },
    { pane_id: "wQ:p2", tab_id: "wQ:t2", workspace_id: "wQ", agent_status: "idle", name: "do" },
  ];
  const ctx = createServerContext(HERDR_ENV, herdr);
  ctx.workflowResult = {
    ok: true,
    workflow: normalizeWorkflow(TWO_ROLE_FIXTURE, "custom", null),
  };
  const result = await handleWhoami(ctx);
  assertEquals(result.structuredContent?.role, "plan");
  const edges = result.structuredContent?.edges as { id: string }[];
  assertEquals(edges[0]?.id, "plan_to_do");
});

Deno.test("tools: pane_read by tab_label with single pane", async () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t4", workspace_id: "wQ", label: "fish" });
  herdr.panes.push({
    pane_id: "wQ:p4",
    tab_id: "wQ:t4",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  herdr.paneReadResponses.set("wQ:p4", "fish shell output");
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRead(ctx, { tab_label: "fish" });
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.pane_id, "wQ:p4");
  assertEquals(result.structuredContent?.tab_label, "fish");
  assertEquals(result.structuredContent?.transcript, "fish shell output");
  assertEquals(herdr.paneReadCalls.length, 1);
  assertEquals(herdr.paneReadCalls[0]?.target, "wQ:p4");
  assertEquals(herdr.paneReadCalls[0]?.source, "recent-unwrapped");
});

Deno.test("tools: pane_read ambiguous tab_label", async () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t4", workspace_id: "wQ", label: "split" });
  herdr.panes.push({
    pane_id: "wQ:p4",
    tab_id: "wQ:t4",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  herdr.panes.push({
    pane_id: "wQ:p5",
    tab_id: "wQ:t4",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRead(ctx, { tab_label: "split" });
  assertEquals(result.structuredContent?._tag, "ambiguous_target");
});

Deno.test("tools: pane_read unknown tab_label", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRead(ctx, { tab_label: "missing" });
  assertEquals(result.structuredContent?._tag, "unknown_target");
});

Deno.test("tools: pane_read foreign pane_id", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRead(ctx, { pane_id: "wX:p9" });
  assertEquals(result.structuredContent?._tag, "unknown_target");
});

Deno.test("tools: pane_read shell pane does not use agentRead", async () => {
  const herdr = mockWorkspace();
  herdr.panes.push({
    pane_id: "wQ:p4",
    tab_id: "wQ:t1",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  await handlePaneRead(ctx, { pane_id: "wQ:p4" });
  assertEquals(herdr.paneReadCalls.length, 1);
  assertEquals(herdr.readResponses.size, 0);
});

Deno.test("tools: read still uses agentRead", async () => {
  const herdr = mockWorkspace();
  herdr.readResponses.set("impl", "agent transcript");
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handleRead(ctx, { role: "impl" });
  assertEquals(result.structuredContent?.transcript, "agent transcript");
  assertEquals(herdr.paneReadCalls.length, 0);
});
