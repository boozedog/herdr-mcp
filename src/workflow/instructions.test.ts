import { assertEquals, assertMatch } from "@std/assert";
import { dirname, join } from "@std/path";
import { generateInstructions } from "./instructions.ts";
import { loadWorkflowFromFile } from "./loader.ts";
import { normalizeWorkflow, RESEARCH_IMPL_REVIEW_PRESET } from "./preset.ts";
import { InvalidConfig } from "../errors.ts";

const FIXTURES = join(dirname(new URL(import.meta.url).pathname), "../../test/fixtures");

function forbiddenToolNames(text: string): boolean {
  const banned = ["agent_read", "agent_wait"];
  for (const name of banned) {
    if (text.includes(name)) return true;
  }
  if (/\b`read`\b/.test(text)) return true;
  if (/\b`wait`\b/.test(text)) return true;
  if (/\btools\/read\b/.test(text)) return true;
  if (/\btools\/wait\b/.test(text)) return true;
  return false;
}

function mentionsRole(text: string, roleId: string): boolean {
  return new RegExp(`\\b${roleId}\\b`).test(text);
}

function endsAtWordBoundary(text: string): boolean {
  if (text.length === 0) return true;
  return !/\w$/.test(text);
}

Deno.test("instructions: preset names directional tools fire-and-forget", () => {
  const text = generateInstructions({
    ok: true,
    workflow: normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null),
  });
  assertMatch(text, /fire-and-forget/);
  assertMatch(text, /Tools \(research_to_impl/);
  assertMatch(text, /impl_to_review/);
  assertMatch(text, /review_to_impl/);
  assertMatch(text, /do not wait/);
  assertMatch(text, /reverse edge/);
  assertMatch(text, /Do not scrape agent TUIs for findings/);
  assertMatch(text, /pane_read/);
  assertMatch(text, /pane_run/);
  assertMatch(text, /agent_pane/);
  assertMatch(text, /Round submit \(impl_to_review\)/);
  assertMatch(text, /Round respond \(review_to_impl\)/);
  assertEquals(forbiddenToolNames(text), false);
  assertEquals(text.includes("boozedog"), false);
  assertEquals(text.includes("gitea"), false);

  const lead = text.slice(0, 512);
  assertEquals(lead.includes("whoami"), true);
  assertEquals(lead.includes("fire-and-forget"), true);
  assertEquals(lead.includes("pane_read"), true);
  assertEquals(lead.includes("pane_run"), true);
  assertEquals(lead.includes("agent_pane"), true);
  assertEquals(endsAtWordBoundary(lead), true);
});

Deno.test("instructions: two-role fixture mentions only plan and do", () => {
  const result = loadWorkflowFromFile(join(FIXTURES, "two-role.toml"));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const text = generateInstructions(result);
  assertMatch(text, /Roles: plan, do/);
  assertMatch(text, /plan_to_do/);
  assertEquals(mentionsRole(text, "review"), false);
  assertEquals(mentionsRole(text, "research"), false);
  assertEquals(mentionsRole(text, "impl"), false);
  assertEquals(text.includes("reverse edge"), false);
  assertEquals(text.includes("Round submit"), false);
  assertEquals(text.includes("Round respond"), false);
  assertEquals(forbiddenToolNames(text), false);
});

Deno.test("instructions: invalid config says config is invalid", () => {
  const text = generateInstructions({
    ok: false,
    error: new InvalidConfig({
      message: "bad",
      path: "/tmp/bad.toml",
      schema_path: "roles",
      detail: "missing",
    }),
  });
  assertMatch(text, /invalid/i);
  assertMatch(text, /invalid_config/);
  assertMatch(text, /Inside Herdr/);
});
