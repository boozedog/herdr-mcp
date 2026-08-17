import { assertEquals } from "@std/assert";
import { Schema } from "effect";
import { notInHerdrError, NotInHerdr, encodeError } from "./errors.ts";
import { isInHerdr, readHerdrEnvIds } from "./herdr-env.ts";
import { NoArgs, toMcpInputSchema } from "./mcp-schema.ts";
import { detectRole } from "./pairing.ts";
import { handleWhoami } from "./tools/whoami.ts";
import { createServerContext } from "./context.ts";
import { MockHerdrClient } from "./herdr/client.ts";
import { computeToolNames } from "./server.ts";
import { normalizeWorkflow, RESEARCH_IMPL_REVIEW_PRESET } from "./workflow/preset.ts";

Deno.test("mcp-schema: NoArgs advertises a clean object JSON schema", () => {
  const schema = toMcpInputSchema(NoArgs);
  const jsonSchema = schema["~standard"].jsonSchema.input({
    target: "draft-07",
  });
  assertEquals(jsonSchema, { type: "object" });
});

Deno.test("mcp-schema: toMcpInputSchema exposes validate and jsonSchema", () => {
  const schema = toMcpInputSchema(NoArgs);
  assertEquals(typeof schema["~standard"].validate, "function");
  assertEquals(typeof schema["~standard"].jsonSchema.input, "function");
});

Deno.test("errors: NotInHerdr encodes with snake_case tag", () => {
  const encoded = Schema.encodeUnknownSync(NotInHerdr)(notInHerdrError());
  assertEquals(encoded, {
    _tag: "not_in_herdr",
    message: notInHerdrError().message,
  });
});

Deno.test("errors: encodeError round-trips tags", () => {
  const encoded = encodeError(notInHerdrError());
  assertEquals(encoded._tag, "not_in_herdr");
});

Deno.test("herdr-env: isInHerdr requires HERDR_ENV=1", () => {
  assertEquals(isInHerdr({}), false);
  assertEquals(isInHerdr({ HERDR_ENV: "0" }), false);
  assertEquals(isInHerdr({ HERDR_ENV: "1" }), true);
});

Deno.test("herdr-env: readHerdrEnvIds returns ids when all are set", () => {
  assertEquals(
    readHerdrEnvIds({
      HERDR_WORKSPACE_ID: "w1",
      HERDR_TAB_ID: "t1",
      HERDR_PANE_ID: "p1",
    }),
    { workspace_id: "w1", tab_id: "t1", pane_id: "p1" },
  );
});

Deno.test("server: whoami without HERDR_ENV returns structured not_in_herdr", async () => {
  const ctx = createServerContext({}, new MockHerdrClient());
  const result = await handleWhoami(ctx);
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent?._tag, "not_in_herdr");
});

Deno.test("server: whoami with HERDR_ENV returns expanded contract", async () => {
  const herdr = new MockHerdrClient();
  herdr.tabs = [{ tab_id: "wQ:t2", workspace_id: "wQ", label: "impl" }];
  herdr.panes = [{
    pane_id: "wQ:p2",
    tab_id: "wQ:t2",
    workspace_id: "wQ",
    agent_status: "idle",
    name: "impl",
  }];
  const ctx = createServerContext({
    HERDR_ENV: "1",
    HERDR_WORKSPACE_ID: "wQ",
    HERDR_TAB_ID: "wQ:t2",
    HERDR_PANE_ID: "wQ:p2",
  }, herdr);
  const result = await handleWhoami(ctx);
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.workspace_id, "wQ");
  assertEquals(result.structuredContent?.role, "impl");
  assertEquals(result.structuredContent?.mutate, true);
});

Deno.test("server: preset exposes six base tools plus three directional", () => {
  const names = computeToolNames({
    ok: true,
    workflow: normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null),
  });
  assertEquals(names.length, 9);
});
