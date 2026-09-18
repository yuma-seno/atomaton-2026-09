#!/usr/bin/env bun
// @bun

// src/atomaton-runtime/tools/hooks/note_file_opened.ts
import { writeFileSync } from "fs";

// src/domain/search-streak.ts
var TOOLS_THAT_OPEN = /(^|__)(read|read_text_file|read_media_file|read_multiple_files|read_file)$/;
function toolOpens(tool) {
  return TOOLS_THAT_OPEN.test(tool.trim());
}

// src/atomaton-runtime/tools/lib/search-streak-file.ts
function streakFile() {
  const opsLog = process.env.ATOMATON_OPS_LOG;
  if (!opsLog)
    return;
  const dir = opsLog.replace(/[/\\][^/\\]*$/, "");
  return dir === opsLog ? undefined : `${dir}/search-streak`;
}

// src/atomaton-runtime/tools/hooks/note_file_opened.ts
async function main() {
  let tool = "";
  try {
    const raw = await new Response(Bun.stdin.stream()).text();
    tool = String(JSON.parse(raw).tool ?? "");
  } catch {
    return;
  }
  if (!toolOpens(tool))
    return;
  const file = streakFile();
  if (!file)
    return;
  try {
    writeFileSync(file, "0");
  } catch {}
}
if (import.meta.main)
  await main();
