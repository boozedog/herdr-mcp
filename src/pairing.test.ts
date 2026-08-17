import { assertEquals, assertExists } from "@std/assert";
import { detectRole, extractSuffix, isImplCapableLabel } from "./pairing.ts";
import { RESEARCH_IMPL_REVIEW_PRESET } from "./workflow/preset.ts";

const roles = RESEARCH_IMPL_REVIEW_PRESET.roles;

Deno.test("pairing: suffix preservation", () => {
  assertEquals(detectRole("research", roles).suffix, "");
  assertEquals(detectRole("research2", roles).role_id, "research");
  assertEquals(detectRole("research2", roles).suffix, "2");
  assertEquals(detectRole("impl-foo", roles).role_id, "impl");
  assertEquals(detectRole("impl-foo", roles).suffix, "-foo");
});

Deno.test("pairing: case insensitivity", () => {
  assertEquals(detectRole("Research2", roles).role_id, "research");
  assertEquals(detectRole("IMPL", roles).role_id, "impl");
});

Deno.test("pairing: unknown label", () => {
  assertEquals(detectRole("git", roles).role_id, "unknown");
  assertEquals(detectRole("implementation", roles).role_id, "unknown");
});

Deno.test("pairing: final/codex aliases", () => {
  assertEquals(detectRole("codex", roles).role_id, "final");
  assertEquals(detectRole("final2", roles).role_id, "final");
  assertEquals(extractSuffix("codex2", roles[3]!), "2");
});

Deno.test("pairing: impl-capable regex positives", () => {
  assertEquals(isImplCapableLabel("impl"), true);
  assertEquals(isImplCapableLabel("impl2"), true);
  assertEquals(isImplCapableLabel("impl-foo"), true);
});

Deno.test("pairing: impl-capable regex negatives", () => {
  assertEquals(isImplCapableLabel("implementation"), false);
  assertEquals(isImplCapableLabel("implies"), false);
  assertEquals(isImplCapableLabel("research"), false);
});
