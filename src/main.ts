import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createHerdrMcpServer } from "./server.ts";

if (import.meta.main) {
  serveStdio(() => createHerdrMcpServer());
}
