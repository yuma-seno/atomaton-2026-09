#!/usr/bin/env bun
// A minimal MCP stdio server, for probing what `atoma validate --with-live-tools`
// actually does. Tools come from FAKE_TOOLS (JSON array of {name}), and
// FAKE_DIE=1 makes it exit immediately instead of serving.
import { createInterface } from "node:readline";

if (process.env.FAKE_DIE === "1") {
  process.stderr.write("fake: refusing to start\n");
  process.exit(1);
}

const tools: { name: string }[] = JSON.parse(process.env.FAKE_TOOLS ?? "[]");

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification
  let result: any;
  switch (msg.method) {
    case "initialize":
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: process.env.FAKE_NAME ?? "fake", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = { tools: tools.map((t) => ({ name: t.name, description: "", inputSchema: { type: "object" } })) };
      break;
    default:
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } }) + "\n",
      );
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
});
