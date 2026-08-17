import { assertEquals } from "@std/assert";
import { Schema } from "effect";
import { notInHerdrError, NotInHerdr } from "./errors.ts";
import { isInHerdr, readHerdrEnvIds } from "./herdr-env.ts";
import { NoArgs, toMcpInputSchema } from "./mcp-schema.ts";
import {
  encodeNotInHerdr,
  handleWhoami,
  notInHerdrResult,
  TOOL_NAMES,
} from "./server.ts";

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

Deno.test("server: whoami without HERDR_ENV returns structured not_in_herdr", () => {
  const result = handleWhoami({});
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent, encodeNotInHerdr(notInHerdrError()));
});

Deno.test("server: whoami with HERDR_ENV returns pane ids", () => {
  const result = handleWhoami({
    HERDR_ENV: "1",
    HERDR_WORKSPACE_ID: "wQ",
    HERDR_TAB_ID: "wQ:t2",
    HERDR_PANE_ID: "wQ:p2",
  });
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent, {
    workspace_id: "wQ",
    tab_id: "wQ:t2",
    pane_id: "wQ:p2",
  });
});

Deno.test("server: notInHerdrResult is structured and marked isError", () => {
  const result = notInHerdrResult();
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent?._tag, "not_in_herdr");
});

Deno.test("server: exposes whoami tool name", () => {
  assertEquals(TOOL_NAMES, ["whoami"]);
});
