import { assertEquals, assertExists } from "@std/assert";
import { dirname, join } from "@std/path";
import { loadWorkflow, loadWorkflowFromFile } from "./loader.ts";
import { normalizeWorkflow, RESEARCH_IMPL_REVIEW_PRESET } from "./preset.ts";

const FIXTURES = join(dirname(new URL(import.meta.url).pathname), "../../test/fixtures");

Deno.test("workflow: missing file uses preset", () => {
  const prev = Deno.env.get("HERDR_MCP_CONFIG");
  try {
    Deno.env.delete("HERDR_MCP_CONFIG");
    const result = loadWorkflow("/nonexistent/empty/dir");
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.workflow.name, "research-impl-review");
      assertEquals(result.workflow.config_path, null);
      assertEquals(result.workflow.edges.length, 3);
    }
  } finally {
    if (prev) Deno.env.set("HERDR_MCP_CONFIG", prev);
  }
});

Deno.test("workflow: two-role fixture", () => {
  const path = join(FIXTURES, "two-role.toml");
  const result = loadWorkflowFromFile(path);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.workflow.roles.map((r) => r.id), ["plan", "do"]);
    assertEquals(result.workflow.edges.map((e) => e.id), ["plan_to_do"]);
  }
});

Deno.test("workflow: bad config returns invalid_config", () => {
  const path = join(FIXTURES, "bad-config.toml");
  const result = loadWorkflowFromFile(path);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error._tag, "invalid_config");
    assertEquals(result.error.path, path);
    assertExists(result.error.schema_path);
  }
});

Deno.test("workflow: HERDR_MCP_CONFIG bad file does not fall back", () => {
  const path = join(FIXTURES, "bad-config.toml");
  const prev = Deno.env.get("HERDR_MCP_CONFIG");
  try {
    Deno.env.set("HERDR_MCP_CONFIG", path);
    const result = loadWorkflow();
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error._tag, "invalid_config");
  } finally {
    if (prev) Deno.env.set("HERDR_MCP_CONFIG", prev);
    else Deno.env.delete("HERDR_MCP_CONFIG");
  }
});

Deno.test("workflow: preset pairing table", () => {
  const wf = normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null);
  const edges = Object.fromEntries(wf.edges.map((e) => [e.id, e]));
  assertEquals(edges.research_to_impl?.wait, false);
  assertEquals(edges.impl_to_review?.wait, true);
  assertEquals(edges.review_to_impl?.wait, false);
});
