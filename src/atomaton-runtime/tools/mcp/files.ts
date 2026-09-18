#!/usr/bin/env bun
/**
 * files.ts — read, search and change files, under the names every agent already knows.
 *
 * ## Why this exists rather than `@modelcontextprotocol/server-filesystem`
 *
 * The official server has no line range and no content search. Measured across two runs
 * of this project's own agents, 202 tool calls: 37 of the 63 shell calls were
 * `sed -n A,Bp` and `grep -rn`, the agent rebuilding both by hand. The orchestrator,
 * which has no shell, could not — it read one 1,700-line file four times with `head`
 * and `tail`, which never reach the middle, and 43% of everything it read came back
 * truncated.
 *
 * Candidates with the missing capabilities were evaluated by starting them and reading
 * their real schemas, because the documentation was wrong about the official one. None
 * was both mature and complete: the server that is official lacks the primitives, and
 * the ones that have them are single-author projects, one without a licence. Adopting
 * any would also have meant 14 to 17 tools where six will do, with names and truncation
 * messages belonging to somebody else.
 *
 * ## The names
 *
 * `read`, `grep`, `glob`, `edit`, `write`, `list` — what OpenCode and Claude Code call
 * them, which is what a model has seen most. They arrive unprefixed because this server
 * sets `unprefixed: true`; see `ToolDef::unprefixed` in the core for why two servers
 * cannot both claim a name and what happens when they try.
 *
 * ## The rule every result here follows
 *
 * A result that left something out says what to ask for to get the rest. A truncation
 * that stops mid-file with no next step is what produced four reads of one file: the
 * agent changed `head: 40` to `head: 760` because nothing told it that the number it
 * was changing does not decide how much comes back.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { isAbsolute, resolve, relative, sep, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { buildMcpTools, defineMcpTool, serveMcpServer, z, type McpToolResult } from "../../../lib/mcp-tool.ts";
import { TOOL_OUTPUT_BUDGET } from "../../../domain/tool-output.ts";
import { WORKSPACE_PATH } from "../../../domain/workspace.ts";
import { MAX_IMAGE_BYTES, sniffMimeType } from "../../../lib/issue-images.ts";
import { hardenCredentialHolder } from "../lib/harden.ts";

function log(message: string): void {
  console.error(`[atomaton-files] ${message}`);
}

hardenCredentialHolder(log);

/**
 * Where this server will look.
 *
 * The work tree, and the shared workspace. The official server was given the work tree
 * alone, so `/tmp/atomaton-workspace` was reachable from the shell and from nothing
 * else — while the prompt template told every agent it was "an ordinary directory, on
 * the same filesystem, at the same path for every tool". That sentence is true now.
 */
const ROOTS = [resolve(process.cwd()), WORKSPACE_PATH];

/** Lines returned by one `read` when the caller does not say. */
const DEFAULT_READ_LINES = 400;

/** Matching lines reported by one `grep` when the caller does not say. */
const DEFAULT_MAX_MATCHES = 60;

/**
 * A path inside one of the roots, or an error naming what is allowed.
 *
 * Resolved before comparing, so `../` cannot walk out of the tree, and compared with a
 * separator appended so that `/tmp/atomaton-workspace-other` does not pass as the
 * workspace.
 */
function within(path: string): string {
  const full = isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
  const inside = ROOTS.some(
    (root) => full === root || full.startsWith(root.endsWith(sep) ? root : root + sep),
  );
  if (!inside) {
    throw new Error(
      `'${path}' is outside the directories this tool can reach. They are: ${ROOTS.join(", ")}.`,
    );
  }
  return full;
}

/** How a path is shown back: relative to the work tree when it is inside it. */
function shown(full: string): string {
  const rel = relative(process.cwd(), full);
  return rel && !rel.startsWith("..") ? rel.split(sep).join("/") : full;
}

const READ_SCHEMA = z.object({
  path: z.string().describe("File to read. Relative to the working directory, or absolute."),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "First line to return, counting from 1. Default 1. To continue a read that stopped early, pass the offset its result named.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `How many lines to return. Default ${DEFAULT_READ_LINES}. A larger number is clipped by the size budget, and the result says how far it actually got.`,
    ),
});

/**
 * Lines of a file, numbered, and how to get the rest.
 *
 * Numbered because every error a compiler emits and every other tool here speaks in
 * line numbers, and a range asked for by line is unusable when what comes back is not.
 */
function readFile(a: z.infer<typeof READ_SCHEMA>): McpToolResult {
  const full = within(a.path);
  if (!existsSync(full)) throw new Error(`'${a.path}' does not exist.`);
  if (statSync(full).isDirectory()) throw new Error(`'${a.path}' is a directory. Use list.`);

  // A picture comes back as a picture, which the server this replaces did through a
  // separate `read_media_file`. One tool rather than two, because the caller asking
  // for a screenshot is asking to read a file and should not have to know in advance
  // which kind it is. The type is sniffed from the bytes, not taken from the
  // extension: a file named `.png` holding something else is what a provider rejects.
  const bytes = new Uint8Array(readFileSync(full));
  const mimeType = sniffMimeType(bytes);
  if (mimeType) {
    const data = Buffer.from(bytes).toString("base64");
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error(`'${a.path}' is too large an image to include (${bytes.length} bytes).`);
    }
    log(`read ${shown(full)} as ${mimeType}, ${bytes.length}B`);
    return { text: `Image ${shown(full)} (${mimeType}).`, images: [{ type: "image", data, mimeType }] };
  }

  const lines = readFileSync(full, "utf8").split("\n");
  // A trailing newline leaves one empty last element, which is not a line of the file.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const total = lines.length;
  const from = a.offset ?? 1;
  if (total === 0) return { text: `${shown(full)} is empty.` };
  if (from > total) throw new Error(`'${a.path}' has ${total} lines; offset ${from} is past the end.`);

  const wanted = Math.min(a.limit ?? DEFAULT_READ_LINES, total - from + 1);
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < wanted; i += 1) {
    const numbered = `${from + i}\t${lines[from + i - 1]}`;
    // The budget, rather than the line count, is usually what stops this. Both are
    // reported the same way, because to the caller they are the same event.
    if (used + numbered.length + 1 > TOOL_OUTPUT_BUDGET) break;
    out.push(numbered);
    used += numbered.length + 1;
  }

  const last = from + out.length - 1;
  const more =
    last < total ? `\n\n[${total - last} more lines. Read again with offset: ${last + 1}.]` : "";
  log(`read ${shown(full)} ${from}-${last}/${total}`);
  return { text: `${shown(full)} lines ${from}-${last} of ${total}\n\n${out.join("\n")}${more}` };
}

const GREP_SCHEMA = z.object({
  pattern: z.string().describe("Extended regular expression, as `grep -E` reads it."),
  path: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe("File or directory to search, or several of them. Default: the working directory."),
  glob: z
    .string()
    .optional()
    .describe("Only search files whose name matches this shell glob, such as `*.ts`. Matched against the file name, not the whole path."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Skip files and directories whose name matches any of these globs, such as `node_modules` or `*.min.js`."),
  context: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Lines of surrounding context to include with each match. Default 0."),
  max_matches: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How many lines to return. Default ${DEFAULT_MAX_MATCHES}. With context set, the surrounding lines count towards it. The result says when it stopped early.`),
  case_sensitive: z.boolean().optional().default(true).describe("Match case. Default true."),
});

/**
 * Content search, with the file and line on every match.
 *
 * `grep -E` rather than ripgrep: ripgrep is not on the runner image, and installing it
 * on every run to gain speed on a repository this size would be paying for something
 * nobody has measured wanting.
 */
function grepFiles(a: z.infer<typeof GREP_SCHEMA>): McpToolResult {
  const asked = a.path === undefined ? ["."] : Array.isArray(a.path) ? a.path : [a.path];
  const limit = a.max_matches ?? DEFAULT_MAX_MATCHES;

  // grep is given relative paths so that it prints relative paths, rather than being
  // given absolute ones and having the prefix cut off afterwards. Cutting at the first
  // colon is what a line like `C:\repo\file.ts:9:...` breaks, and the runner being
  // Linux is not a reason to write something that is wrong anywhere else.
  const targets = asked.map((one) => {
    const full = within(one);
    const rel = relative(process.cwd(), full);
    return rel === "" ? "." : rel.startsWith("..") ? full : rel.split(sep).join("/");
  });

  const args = ["-E", "-n", "-I", "-r"];
  if (!a.case_sensitive) args.push("-i");
  if (a.context) args.push(`-C${a.context}`);
  if (a.glob) args.push(`--include=${a.glob}`);
  // Both forms per pattern, because a caller writing `node_modules` means the
  // directory and one writing `*.min.js` means the files, and asking which they meant
  // is a round trip to learn something neither of them cares about.
  for (const skip of a.exclude ?? []) {
    args.push(`--exclude=${skip}`, `--exclude-dir=${skip}`);
  }
  // `-m` is per file, not per search, so it does not bound the answer -- a hundred
  // files each stopping at the limit still returns a hundred times it. The bound that
  // holds is the slice below; this only stops one pathological file filling the buffer.
  args.push(`-m${limit + 1}`, "-e", a.pattern, "--", ...targets);

  const run = spawnSync("grep", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`grep could not be run: ${run.error.message}`);
  // grep exits 1 for "no matches", which is an answer rather than a failure. Anything
  // above that is the tool failing, and saying so matters: a broken search and a clean
  // repository return the same empty result otherwise.
  if (run.status !== null && run.status > 1) {
    throw new Error(`grep failed (exit ${run.status}): ${(run.stderr || "").trim() || "no output"}`);
  }

  const found = (run.stdout || "").split("\n").filter((line) => line.length > 0);
  if (found.length === 0) {
    return {
      text: `No match for ${a.pattern}${a.glob ? ` in ${a.glob} files` : ""} under ${targets.join(", ")}.`,
    };
  }

  const kept: string[] = [];
  let used = 0;
  for (const line of found.slice(0, limit)) {
    if (used + line.length + 1 > TOOL_OUTPUT_BUDGET) break;
    kept.push(line);
    used += line.length + 1;
  }

  const dropped = found.length - kept.length;
  const note =
    dropped > 0
      ? `\n\n[${dropped} or more further lines. Narrow the pattern, set glob, or raise max_matches.]`
      : "";
  // Lines, not matches: with context set, most of them are the lines around one.
  const what = a.context ? "line(s), match and context," : "matching line(s)";
  log(`grep ${a.pattern} -> ${kept.length} line(s)${dropped > 0 ? `, ${dropped} dropped` : ""}`);
  return { text: `${kept.length} ${what} under ${targets.join(", ")}:\n\n${kept.join("\n")}${note}` };
}

const GLOB_SCHEMA = z.object({
  pattern: z.string().describe("Glob over paths, such as `src/**/*.ts`. Matched against the path relative to `path`."),
  path: z.string().optional().describe("Directory to search under. Default: the working directory."),
});

/** File names matching a glob, most recently changed first. */
function globFiles(a: z.infer<typeof GLOB_SCHEMA>): McpToolResult {
  const root = within(a.path ?? ".");
  const found: { path: string; at: number }[] = [];
  for (const hit of new Bun.Glob(a.pattern).scanSync({ cwd: root, onlyFiles: true, dot: false })) {
    const full = resolve(root, hit);
    try {
      found.push({ path: shown(full), at: statSync(full).mtimeMs });
    } catch {
      // Gone between the scan and the stat. Not an error: it is simply not there.
    }
  }
  if (found.length === 0) return { text: `No file matches ${a.pattern} under ${shown(root)}.` };

  // Most recently changed first: the file somebody is working on is the one being
  // looked for, and alphabetical order buries it among its neighbours.
  found.sort((x, y) => y.at - x.at);
  const kept: string[] = [];
  let used = 0;
  for (const { path } of found) {
    if (used + path.length + 1 > TOOL_OUTPUT_BUDGET) break;
    kept.push(path);
    used += path.length + 1;
  }
  const dropped = found.length - kept.length;
  const note = dropped > 0 ? `\n\n[${dropped} more. Narrow the pattern.]` : "";
  log(`glob ${a.pattern} -> ${kept.length}/${found.length}`);
  return { text: `${found.length} file(s), most recently changed first:\n\n${kept.join("\n")}${note}` };
}

const EDIT_SCHEMA = z.object({
  path: z.string().describe("File to change."),
  old_string: z
    .string()
    .describe("Exact text to replace, including its indentation. Must appear exactly once unless replace_all is set."),
  new_string: z.string().describe("Text to put in its place."),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe("Replace every occurrence instead of requiring exactly one."),
});

/**
 * One exact replacement.
 *
 * Text that appears more than once is refused rather than taking the first: a caller
 * that meant the third has no way to say so, and a wrong edit made quietly is found
 * much later than a refusal.
 */
function editFile(a: z.infer<typeof EDIT_SCHEMA>): McpToolResult {
  const full = within(a.path);
  if (!existsSync(full)) throw new Error(`'${a.path}' does not exist. Use write to create it.`);
  const before = readFileSync(full, "utf8");
  const count = before.split(a.old_string).length - 1;
  if (count === 0) {
    throw new Error(
      `That text is not in '${a.path}'. Read the file and copy the text exactly, including indentation.`,
    );
  }
  if (count > 1 && !a.replace_all) {
    throw new Error(
      `That text appears ${count} times in '${a.path}'. Include enough surrounding lines to make it unique, or set replace_all.`,
    );
  }
  const after = a.replace_all
    ? before.split(a.old_string).join(a.new_string)
    : before.replace(a.old_string, a.new_string);
  writeFileSync(full, after);
  const changed = a.replace_all ? count : 1;
  log(`edit ${shown(full)} x${changed}`);
  return { text: `Replaced ${changed} occurrence(s) in ${shown(full)}.` };
}

const WRITE_SCHEMA = z.object({
  path: z.string().describe("File to write. Parent directories are created."),
  content: z.string().describe("The whole contents of the file. This replaces what is there."),
});

/** Write a file whole, creating the directories above it. */
function writeWholeFile(a: z.infer<typeof WRITE_SCHEMA>): McpToolResult {
  const full = within(a.path);
  mkdirSync(dirname(full), { recursive: true });
  const existed = existsSync(full);
  writeFileSync(full, a.content);
  log(`write ${shown(full)} ${a.content.length}B`);
  return { text: `${existed ? "Replaced" : "Wrote"} ${shown(full)} (${a.content.length} characters).` };
}

const LIST_SCHEMA = z.object({
  path: z.string().optional().describe("Directory to list. Default: the working directory."),
});

/** What is in a directory, one entry per line. */
function listDirectory(a: z.infer<typeof LIST_SCHEMA>): McpToolResult {
  const asked = a.path ?? ".";
  const full = within(asked);
  if (!existsSync(full)) throw new Error(`'${asked}' does not exist.`);
  if (!statSync(full).isDirectory()) throw new Error(`'${asked}' is a file. Use read.`);

  const rows: string[] = [];
  const entries = readdirSync(full, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      rows.push(`${entry.name}/`);
      continue;
    }
    let size = "";
    try {
      size = ` (${statSync(resolve(full, entry.name)).size}B)`;
    } catch {
      // Unreadable or gone; the name still answers what is here.
    }
    rows.push(`${entry.name}${size}`);
  }
  log(`list ${shown(full)} -> ${rows.length}`);
  return { text: `${shown(full)}:\n\n${rows.join("\n") || "(empty)"}` };
}

const { tools, dispatch } = buildMcpTools([
  defineMcpTool({
    name: "read",
    description:
      "Read a range of lines from a file, numbered. Give offset and limit to read part of a large file; a result that stopped early names the offset to continue from, so a file of any size can be read in order without guessing. A file that holds an image comes back as an image, for an agent whose definition sets vision. Prefer this over cat, head, tail or sed through the shell, which return unnumbered text and cost a round trip.",
    schema: READ_SCHEMA,
    handler: readFile,
  }),
  defineMcpTool({
    name: "grep",
    description:
      "Search file contents for an extended regular expression, returning file, line number and the matching line. path takes one place to look or several. Set glob to restrict which files are searched, exclude to skip directories such as node_modules, and context to include surrounding lines. Prefer this over grep through the shell. A search says where something is, not what it means: when it finds the place, read the file around it rather than searching again with a different pattern.",
    schema: GREP_SCHEMA,
    handler: grepFiles,
  }),
  defineMcpTool({
    name: "glob",
    description:
      "Find files by a glob over their paths, such as src/**/*.ts, most recently changed first. Use this to find where something lives by name, and grep to find it by content.",
    schema: GLOB_SCHEMA,
    handler: globFiles,
  }),
  defineMcpTool({
    name: "edit",
    description:
      "Replace an exact piece of text in a file. The text must appear exactly once unless replace_all is set, so include enough surrounding lines to make it unique. Text that is absent, or found more than once, is an error rather than a guess at what was meant.",
    schema: EDIT_SCHEMA,
    handler: editFile,
  }),
  defineMcpTool({
    name: "write",
    description:
      "Write a whole file, creating parent directories. This replaces the file's contents; to change part of an existing file use edit, which cannot discard the rest by accident.",
    schema: WRITE_SCHEMA,
    handler: writeWholeFile,
  }),
  defineMcpTool({
    name: "list",
    description:
      "List a directory's entries, directories marked with a trailing slash and files with their size. Listing says where things are, which is what a search says; it is not a substitute for reading one.",
    schema: LIST_SCHEMA,
    handler: listDirectory,
  }),
]);

async function main(): Promise<void> {
  await serveMcpServer({ name: "atomaton-files-mcp", version: "1.0.0", tools, dispatch, log });
}
if (import.meta.main) void main();
