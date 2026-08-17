import { assertEquals } from "@std/assert";
import {
  parsePromptOutput,
  parseStrictJson,
  snapshotFromHerdrResult,
  stateChanged,
  extractHerdrCliError,
} from "./parse.ts";

Deno.test("parse: strict JSON control", () => {
  const ok = parseStrictJson('{"id":"cli:tab:list","result":{}}');
  assertEquals(ok.ok, true);
  const bad = parseStrictJson("not json");
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.error._tag, "parse_failed");
});

Deno.test("parse: prompt pure JSON", () => {
  const r = parsePromptOutput('{"result":{"accepted":true}}', 0);
  assertEquals(r.kind, "json");
});

Deno.test("parse: prompt JSON with leading noise", () => {
  const r = parsePromptOutput('submitted\n{"result":{"accepted":true}}', 0);
  assertEquals(r.kind, "json");
});

Deno.test("parse: prompt clean exit no JSON", () => {
  const r = parsePromptOutput("prompt accepted", 0);
  assertEquals(r.kind, "accepted");
});

Deno.test("parse: prompt failure", () => {
  const r = parsePromptOutput("broken", 1);
  assertEquals(r.kind, "error");
});

Deno.test("parse: status snapshot from agent get", () => {
  const snap = snapshotFromHerdrResult({
    result: {
      agent: {
        agent_status: "idle",
        revision: 5,
        state_change_seq: 10,
        pane_id: "wQ:p1",
      },
    },
  });
  assertEquals(snap?.agent_status, "idle");
  assertEquals(snap?.revision, 5);
});

Deno.test("parse: status fallback from pane get", () => {
  const snap = snapshotFromHerdrResult({
    result: {
      pane: { agent_status: "working", revision: 2, pane_id: "wQ:p2" },
    },
  });
  assertEquals(snap?.agent_status, "working");
});

Deno.test("parse: confirm revision bump", () => {
  const before = { agent_status: "idle" as const, revision: 1, state_change_seq: 1 };
  const after = { agent_status: "working" as const, revision: 2, state_change_seq: 1 };
  assertEquals(stateChanged(before, after), true);
});

Deno.test("parse: confirm seq bump", () => {
  const before = { agent_status: "idle" as const, revision: 1, state_change_seq: 1 };
  const after = { agent_status: "working" as const, revision: 1, state_change_seq: 2 };
  assertEquals(stateChanged(before, after), true);
});

Deno.test("parse: prompt JSON error object", () => {
  const stdout = '{"error":{"code":"agent_not_found","message":"not found"},"id":"cli:agent:prompt"}';
  const r = parsePromptOutput(stdout, 1);
  assertEquals(r.kind, "error");
  if (r.kind === "error") assertEquals(r.error._tag, "parse_failed");
});

Deno.test("parse: extractHerdrCliError", () => {
  const err = extractHerdrCliError({ error: { code: "timeout", message: "timed out" } });
  assertEquals(err?.code, "timeout");
});
