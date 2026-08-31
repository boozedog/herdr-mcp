import { assertEquals, assertExists } from "@std/assert";
import { Schema } from "effect";
import { createServerContext, resolveByPaneId, resolveTarget } from "./context.ts";
import { MockHerdrClient } from "./herdr/client.ts";
import { handleHandoff } from "./tools/handoff.ts";
import { handlePeers } from "./tools/peers.ts";
import {
  handleDirectionalEdge,
  buildDirectionalInputSchema,
  RespondDirectionalArgs,
} from "./tools/directional.ts";
import { resetAllRoundCounters } from "./rounds.ts";
import { handlePaneRead } from "./tools/pane_read.ts";
import { handlePaneRun } from "./tools/pane_run.ts";
import { handleWhoami, handleWorkflow } from "./tools/whoami.ts";
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

Deno.test("tools: default preset tool names excludes read and wait", () => {
  const names = computeToolNames({
    ok: true,
    workflow: normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null),
  });
  assertEquals(names.includes("whoami"), true);
  assertEquals(names.includes("workflow"), true);
  assertEquals(names.includes("research_to_impl"), true);
  assertEquals(names.includes("impl_to_review"), true);
  assertEquals(names.includes("review_to_impl"), true);
  assertEquals(names.includes("read"), false);
  assertEquals(names.includes("wait"), false);
  assertEquals(names.includes("agent_read"), false);
  assertEquals(names.includes("agent_wait"), false);
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

Deno.test("tools: directional submit is fire-and-forget handoff", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  assertEquals(edge.round, "submit");
  const result = await handleDirectionalEdge(ctx, edge, { message: "review me" });
  assertEquals(result.isError, undefined);
  assertEquals(herdr.prompts.length, 1);
  assertEquals(result.structuredContent?.pane_id, "wQ:p3");
  assertEquals(result.structuredContent?.round, 1);
  assertEquals(result.structuredContent?.max_rounds, 5);
  assertEquals(result.structuredContent?.wait, undefined);
  assertEquals(result.structuredContent?.read, undefined);
  assertEquals(herdr.prompts[0]?.text.includes("## Round 1 / 5"), true);
});

Deno.test("tools: directional submit increments round and enforces cap", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  for (let i = 1; i <= 5; i++) {
    const result = await handleDirectionalEdge(ctx, edge, { message: `round ${i}` });
    assertEquals(result.isError, undefined);
    assertEquals(result.structuredContent?.round, i);
  }
  const capped = await handleDirectionalEdge(ctx, edge, { message: "too many" });
  assertEquals(capped.structuredContent?._tag, "round_cap");
  assertEquals(capped.structuredContent?.round, 6);
  assertEquals(capped.structuredContent?.max_rounds, 5);
  assertEquals(capped.structuredContent?.pane_id, "wQ:p3");
  assertEquals(herdr.prompts.length, 5);
});

Deno.test("tools: busy impl_to_review does not increment round counter", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  herdr.panes.find((p) => p.pane_id === "wQ:p3")!.agent_status = "working";
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  const busy = await handleDirectionalEdge(ctx, edge, { message: "review me" });
  assertEquals(busy.structuredContent?._tag, "busy_peer");
  assertEquals(herdr.prompts.length, 0);

  herdr.panes.find((p) => p.pane_id === "wQ:p3")!.agent_status = "idle";
  const ok = await handleDirectionalEdge(ctx, edge, { message: "review me" });
  assertEquals(ok.isError, undefined);
  assertEquals(ok.structuredContent?.round, 1);
  assertEquals(herdr.prompts.length, 1);
  assertEquals(herdr.prompts[0]?.text.includes("## Round 1 / 5"), true);
});

Deno.test("tools: repeated busy impl_to_review never returns round_cap", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  herdr.panes.find((p) => p.pane_id === "wQ:p3")!.agent_status = "blocked";
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  for (let i = 0; i < 6; i++) {
    const result = await handleDirectionalEdge(ctx, edge, { message: `busy ${i}` });
    assertEquals(result.structuredContent?._tag, "busy_peer");
  }
  assertEquals(herdr.prompts.length, 0);
});

Deno.test("tools: confirmation_error after prompt commits round", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  let agentGetCalls = 0;
  const origAgentGet = herdr.agentGet.bind(herdr);
  herdr.agentGet = (target) => {
    agentGetCalls++;
    if (agentGetCalls > 1) return Promise.resolve("not json");
    return origAgentGet(target);
  };
  herdr.failPaneGet = true;
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  const first = await handleDirectionalEdge(ctx, edge, { message: "review me" });
  assertEquals(first.structuredContent?._tag, "confirmation_error");
  assertEquals(herdr.prompts.length, 1);

  herdr.failPaneGet = false;
  herdr.agentGet = origAgentGet;
  const second = await handleDirectionalEdge(ctx, edge, { message: "review again" });
  assertEquals(second.isError, undefined);
  assertEquals(second.structuredContent?.round, 2);
  assertEquals(herdr.prompts[1]?.text.includes("## Round 2 / 5"), true);
});

Deno.test("tools: directional submit reset starts new slice", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  await handleDirectionalEdge(ctx, edge, { message: "first" });
  await handleDirectionalEdge(ctx, edge, { message: "second" });
  const reset = await handleDirectionalEdge(ctx, edge, { message: "new slice", reset: true });
  assertEquals(reset.structuredContent?.round, 1);
});

Deno.test("tools: directional submit max_rounds above config refused", async () => {
  resetAllRoundCounters();
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t2", HERDR_PANE_ID: "wQ:p2" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "impl_to_review")!;
  const result = await handleDirectionalEdge(ctx, edge, {
    message: "review me",
    max_rounds: 99,
  });
  assertEquals(result.structuredContent?._tag, "invalid_config");
  assertEquals(herdr.prompts.length, 0);
});

Deno.test("tools: review_to_impl respond stamps round and status", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t3", HERDR_PANE_ID: "wQ:p3" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const edge = wf.edges.find((e) => e.id === "review_to_impl")!;
  const result = await handleDirectionalEdge(ctx, edge, {
    message: "fix the blocker",
    round: 2,
    status: "CHANGES_REQUESTED",
  });
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.round, 2);
  assertEquals(result.structuredContent?.status, "CHANGES_REQUESTED");
  assertEquals(herdr.prompts[0]?.text.includes("## Round 2 / 5"), true);
  assertEquals(herdr.prompts[0]?.text.includes("## Status CHANGES_REQUESTED"), true);
});

Deno.test("tools: respond schema rejects missing status", () => {
  let threw = false;
  try {
    Schema.decodeUnknownSync(RespondDirectionalArgs)({
      message: "findings",
      round: 1,
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("tools: two-role directional has no round keys in schema", () => {
  const result = loadWorkflowFromFile(fixturePath("two-role.toml"));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const edge = result.workflow.edges[0]!;
  assertEquals(edge.round, undefined);
  const schema = buildDirectionalInputSchema(edge);
  const jsonSchema = schema["~standard"].jsonSchema.input({ target: "draft-07" }) as {
    properties?: Record<string, unknown>;
  };
  assertEquals("round" in (jsonSchema.properties ?? {}), false);
  assertEquals("status" in (jsonSchema.properties ?? {}), false);
  assertEquals("reset" in (jsonSchema.properties ?? {}), false);
  assertEquals("max_rounds" in (jsonSchema.properties ?? {}), false);
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

Deno.test("tools: unsuffixed pairing research3 to impl", () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t5", workspace_id: "wQ", label: "research3" });
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
  const caller = { role_id: "research", suffix: "3", mutate: false };
  const pane = resolveTarget(wf, caller, herdr.tabs, herdr.panes, "wQ", {
    edge: "research_to_impl",
  });
  assertEquals("_tag" in pane, false);
  if (!("_tag" in pane)) assertEquals(pane.pane_id, "wQ:p2");
});

Deno.test("tools: unsuffixed pairing research3 unknown when only impl2", () => {
  const herdr = new MockHerdrClient();
  herdr.tabs = [
    { tab_id: "wQ:t5", workspace_id: "wQ", label: "research3" },
    { tab_id: "wQ:t6", workspace_id: "wQ", label: "impl2" },
  ];
  herdr.panes = [
    {
      pane_id: "wQ:p5",
      tab_id: "wQ:t5",
      workspace_id: "wQ",
      agent_status: "idle",
    },
    {
      pane_id: "wQ:p6",
      tab_id: "wQ:t6",
      workspace_id: "wQ",
      agent_status: "idle",
      name: "impl2",
    },
  ];
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t5", HERDR_PANE_ID: "wQ:p5" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const caller = { role_id: "research", suffix: "3", mutate: false };
  const pane = resolveTarget(wf, caller, herdr.tabs, herdr.panes, "wQ", {
    edge: "research_to_impl",
  });
  assertEquals("_tag" in pane && pane._tag === "unknown_target", true);
});

Deno.test("tools: suffix pairing impl2 to review2", () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t5", workspace_id: "wQ", label: "impl2" });
  herdr.tabs.push({ tab_id: "wQ:t6", workspace_id: "wQ", label: "review2" });
  herdr.panes.push({
    pane_id: "wQ:p5",
    tab_id: "wQ:t5",
    workspace_id: "wQ",
    agent_status: "idle",
    name: "impl2",
  });
  herdr.panes.push({
    pane_id: "wQ:p6",
    tab_id: "wQ:t6",
    workspace_id: "wQ",
    agent_status: "idle",
    name: "review2",
  });
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t5", HERDR_PANE_ID: "wQ:p5" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const caller = { role_id: "impl", suffix: "2", mutate: true };
  const pane = resolveTarget(wf, caller, herdr.tabs, herdr.panes, "wQ", {
    edge: "impl_to_review",
  });
  assertEquals("_tag" in pane, false);
  if (!("_tag" in pane)) assertEquals(pane.pane_id, "wQ:p6");
});

Deno.test("tools: whoami research3 pairs research_to_impl to unsuffixed impl", async () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t5", workspace_id: "wQ", label: "research3" });
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
  const result = await handleWhoami(ctx);
  assertEquals(result.structuredContent?.suffix, "3");
  const edges = result.structuredContent?.edges as { id: string; paired_pane_id?: string }[];
  assertEquals(edges.find((e) => e.id === "research_to_impl")?.paired_pane_id, "wQ:p2");
});

Deno.test("tools: unsuffixed pairing research3 to impl not impl3", () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t5", workspace_id: "wQ", label: "research3" });
  herdr.tabs.push({ tab_id: "wQ:t7", workspace_id: "wQ", label: "impl3" });
  herdr.panes.push({
    pane_id: "wQ:p5",
    tab_id: "wQ:t5",
    workspace_id: "wQ",
    agent_status: "idle",
  });
  herdr.panes.push({
    pane_id: "wQ:p7",
    tab_id: "wQ:t7",
    workspace_id: "wQ",
    agent_status: "idle",
    name: "impl3",
  });
  const ctx = createServerContext(
    { ...HERDR_ENV, HERDR_TAB_ID: "wQ:t5", HERDR_PANE_ID: "wQ:p5" },
    herdr,
  );
  const wf = ctx.workflowResult.ok ? ctx.workflowResult.workflow : null;
  assertExists(wf);
  const caller = { role_id: "research", suffix: "3", mutate: false };
  const pane = resolveTarget(wf, caller, herdr.tabs, herdr.panes, "wQ", {
    edge: "research_to_impl",
  });
  assertEquals("_tag" in pane, false);
  if (!("_tag" in pane)) assertEquals(pane.pane_id, "wQ:p2");
});

Deno.test("tools: omitted pair defaults to suffix plan2 to do2", () => {
  const herdr = new MockHerdrClient();
  herdr.tabs = [
    { tab_id: "wQ:t1", workspace_id: "wQ", label: "plan2" },
    { tab_id: "wQ:t2", workspace_id: "wQ", label: "do" },
    { tab_id: "wQ:t3", workspace_id: "wQ", label: "do2" },
  ];
  herdr.panes = [
    { pane_id: "wQ:p1", tab_id: "wQ:t1", workspace_id: "wQ", agent_status: "idle" },
    { pane_id: "wQ:p2", tab_id: "wQ:t2", workspace_id: "wQ", agent_status: "idle", name: "do" },
    { pane_id: "wQ:p3", tab_id: "wQ:t3", workspace_id: "wQ", agent_status: "idle", name: "do2" },
  ];
  const ctx = createServerContext(HERDR_ENV, herdr);
  ctx.workflowResult = {
    ok: true,
    workflow: normalizeWorkflow(TWO_ROLE_FIXTURE, "custom", null),
  };
  const caller = { role_id: "plan", suffix: "2", mutate: false };
  const pane = resolveTarget(ctx.workflowResult.workflow, caller, herdr.tabs, herdr.panes, "wQ", {
    edge: "plan_to_do",
  });
  assertEquals("_tag" in pane, false);
  if (!("_tag" in pane)) assertEquals(pane.pane_id, "wQ:p3");
});

Deno.test("tools: workflow dump includes effective pair on edges", () => {
  const ctx = createServerContext(HERDR_ENV, mockWorkspace());
  const result = handleWorkflow(ctx);
  const edges = result.structuredContent?.edges as { id: string; pair: string }[];
  assertEquals(edges.find((e) => e.id === "research_to_impl")?.pair, "unsuffixed");
  assertEquals(edges.find((e) => e.id === "impl_to_review")?.pair, "suffix");
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

Deno.test("tools: pane_read works on agent panes", async () => {
  const herdr = mockWorkspace();
  herdr.paneReadResponses.set("wQ:p2", "agent tui snapshot");
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRead(ctx, { pane_id: "wQ:p2" });
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.transcript, "agent tui snapshot");
  assertEquals(herdr.paneReadCalls.length, 1);
});

Deno.test("tools: pane_run refuses agent pane by name", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRun(ctx, { pane_id: "wQ:p2", command: "ls" });
  assertEquals(result.structuredContent?._tag, "agent_pane");
  assertEquals(result.structuredContent?.pane_id, "wQ:p2");
  assertEquals(result.structuredContent?.tab_label, "impl");
  assertEquals(result.structuredContent?.agent_name, "impl");
  assertEquals(result.structuredContent?.agent_status, "idle");
  assertEquals(herdr.paneRunCalls.length, 0);
});

Deno.test("tools: pane_run refuses agent pane by lifecycle status", async () => {
  const herdr = mockWorkspace();
  herdr.panes.push({
    pane_id: "wQ:p7",
    tab_id: "wQ:t1",
    workspace_id: "wQ",
    agent_status: "working",
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRun(ctx, { pane_id: "wQ:p7", command: "ls" });
  assertEquals(result.structuredContent?._tag, "agent_pane");
  assertEquals(herdr.paneRunCalls.length, 0);
});

Deno.test("tools: pane_run allows unknown status without agent name", async () => {
  const herdr = mockWorkspace();
  herdr.tabs.push({ tab_id: "wQ:t4", workspace_id: "wQ", label: "fish" });
  herdr.panes.push({
    pane_id: "wQ:p4",
    tab_id: "wQ:t4",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRun(ctx, { tab_label: "fish", command: "git status" });
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.pane_id, "wQ:p4");
  assertEquals(result.structuredContent?.tab_label, "fish");
  assertEquals(result.structuredContent?.command, "git status");
  assertEquals(result.structuredContent?.accepted, true);
  assertEquals(herdr.paneRunCalls.length, 1);
  assertEquals(herdr.paneRunCalls[0]?.target, "wQ:p4");
  assertEquals(herdr.paneRunCalls[0]?.command, "git status");
});

Deno.test("tools: pane_run ambiguous tab_label", async () => {
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
  const result = await handlePaneRun(ctx, { tab_label: "split", command: "ls" });
  assertEquals(result.structuredContent?._tag, "ambiguous_target");
  assertEquals(herdr.paneRunCalls.length, 0);
});

Deno.test("tools: pane_run unknown tab_label", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRun(ctx, { tab_label: "missing", command: "ls" });
  assertEquals(result.structuredContent?._tag, "unknown_target");
  assertEquals(herdr.paneRunCalls.length, 0);
});

Deno.test("tools: pane_run foreign pane_id", async () => {
  const herdr = mockWorkspace();
  const ctx = createServerContext(HERDR_ENV, herdr);
  const result = await handlePaneRun(ctx, { pane_id: "wX:p9", command: "ls" });
  assertEquals(result.structuredContent?._tag, "unknown_target");
  assertEquals(herdr.paneRunCalls.length, 0);
});

Deno.test("tools: pane_run shell pane does not use agentPrompt", async () => {
  const herdr = mockWorkspace();
  herdr.panes.push({
    pane_id: "wQ:p4",
    tab_id: "wQ:t1",
    workspace_id: "wQ",
    agent_status: "unknown",
  });
  const ctx = createServerContext(HERDR_ENV, herdr);
  await handlePaneRun(ctx, { pane_id: "wQ:p4", command: "git status" });
  assertEquals(herdr.paneRunCalls.length, 1);
  assertEquals(herdr.prompts.length, 0);
});
