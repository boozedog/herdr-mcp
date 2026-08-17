import { assertEquals } from "@std/assert";
import { filterWorkspacePanes, filterWorkspaceTabs, isInWorkspace } from "./workspace.ts";

Deno.test("workspace: id prefix check", () => {
  assertEquals(isInWorkspace("wQ:p1", "wQ"), true);
  assertEquals(isInWorkspace("wX:p1", "wQ"), false);
});

Deno.test("workspace: filter drops foreign tabs/panes", () => {
  const tabs = [
    { tab_id: "wQ:t1", workspace_id: "wQ", label: "research" },
    { tab_id: "wX:t9", workspace_id: "wX", label: "other" },
    { tab_id: "bad", workspace_id: "wQ", label: "bad" },
  ];
  const filtered = filterWorkspaceTabs(tabs, "wQ");
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0]!.tab_id, "wQ:t1");

  const panes = [
    { pane_id: "wQ:p1", workspace_id: "wQ", tab_id: "wQ:t1" },
    { pane_id: "wX:p9", workspace_id: "wX", tab_id: "wX:t9" },
  ];
  assertEquals(filterWorkspacePanes(panes, "wQ").length, 1);
});
