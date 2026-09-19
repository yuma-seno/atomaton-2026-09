/**
 * lib.test.ts — direct tests for src/lib/** functions that lost a
 * standalone CLI entry point during the "system" refactor (their logic was
 * absorbed into src/lib/ and is now called directly, via import, by every
 * caller instead of a subprocess spawn -- see aggregation.ts's doc comment).
 *
 * Since these are plain functions (no `main()`/CLI), each test spawns a
 * tiny generated shim script that imports and calls the target function,
 * reusing the SAME fake-`gh`-via-PATH test harness used for real CLI
 * scripts (src/scripts/testing/harness.ts) -- subprocess isolation is
 * required here, not just convenient: mutating process.env.PATH/
 * FAKE_GH_RESPONSES and calling a gh()-shelling function in the SAME
 * long-lived bun:test process has previously given wrong results (a
 * documented gotcha -- see git history), so every test that needs a faked
 * `gh` MUST spawn a fresh subprocess, never call such a function in-process.
 */
import { describe, expect, test } from "bun:test";
import { unknownToolMessage } from "./mcp-tool.ts";
import { nothingToCommit } from "./gh.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeConfigDir, runWithFakeGh, type FakeGhRule, importable } from "../scripts/testing/harness.ts";
import { extractImageUrls, sniffMimeType } from "./issue-images.ts";
import { looksTransient } from "./gh.ts";
import { injectSummary } from "./inject-sub-results.ts";
import type { Session } from "./session.ts";

const LIB_DIR = import.meta.dir;

/** Writes a temp .ts file containing `code` and returns its absolute path. */
function makeShim(code: string): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-lib-shim-"));
  const file = join(dir, "shim.ts");
  writeFileSync(file, code);
  return { file, dir };
}

describe("sibling-check.ts countOpenSiblings", () => {
  test("counts open siblings via gh issue list", () => {
    const configDir = makeConfigDir({});
    const { file, dir } = makeShim(`
      import { countOpenSiblings } from "${importable(join(LIB_DIR, "sibling-check.ts"))}";
      console.log(countOpenSiblings({ repo: "owner/repo", parent: 5 }));
    `);
    try {
      const r = runWithFakeGh(file, [], {
        cwd: configDir,
        rules: [{ match: ["issue", "list"], stdout: JSON.stringify([{ number: 10 }, { number: 11 }]) }],
      });
      expect(r.stdout.trim()).toBe("2");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints 0 when no siblings are open", () => {
    const configDir = makeConfigDir({});
    const { file, dir } = makeShim(`
      import { countOpenSiblings } from "${importable(join(LIB_DIR, "sibling-check.ts"))}";
      console.log(countOpenSiblings({ repo: "owner/repo", parent: 5 }));
    `);
    try {
      const r = runWithFakeGh(file, [], { cwd: configDir, rules: [{ match: ["issue", "list"], stdout: "[]" }] });
      expect(r.stdout.trim()).toBe("0");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--exclude drops a specific issue number regardless of its live open state", () => {
    const configDir = makeConfigDir({});
    const { file, dir } = makeShim(`
      import { countOpenSiblings } from "${importable(join(LIB_DIR, "sibling-check.ts"))}";
      console.log(countOpenSiblings({ repo: "owner/repo", parent: 5, exclude: 10 }));
    `);
    try {
      const r = runWithFakeGh(file, [], {
        cwd: configDir,
        rules: [{ match: ["issue", "list"], stdout: JSON.stringify([{ number: 10 }, { number: 11 }]) }],
      });
      expect(r.stdout.trim()).toBe("1");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The rule these cover -- find the last tool message, replace it, append when
// there is none -- used to be reachable only through a function that made up to
// three `gh` calls per sub-issue, so testing it needed a fake `gh` on PATH and a
// subprocess. It is a decision about a data structure. It is tested as one.
describe("inject-sub-results.ts injectSummary", () => {
  test("replaces the last tool message", () => {
    const session: Session = {
      messages: [
        { role: "user", content: "go" },
        { role: "tool", content: "launched" },
        { role: "assistant", content: "working" },
        { role: "tool", content: "still going" },
      ],
    };
    const updated = injectSummary(session, "the summary");
    expect(updated.messages?.map((m) => m.content)).toEqual(["go", "launched", "working", "the summary"]);
  });

  // The orchestrator has to see the results somewhere. A session with no tool
  // message is not a reason to drop them.
  test("appends a user message when the session has no tool message", () => {
    const session: Session = { messages: [{ role: "user", content: "go" }] };
    const updated = injectSummary(session, "the summary");
    expect(updated.messages?.at(-1)).toEqual({ role: "user", content: "the summary" });
  });

  test("an empty session still receives the summary", () => {
    const updated = injectSummary({ messages: [] }, "the summary");
    expect(updated.messages).toEqual([{ role: "user", content: "the summary" }]);
  });
});
describe("agent-name.ts", () => {
  test("accepts a bare lowercase name and rejects everything a shell would reinterpret", async () => {
    const { isAgentName } = await import("./agent-name.ts");
    for (const valid of ["engineer", "orchestrator", "e", "code-reviewer", "agent2"]) {
      expect(isAgentName(valid), valid).toBe(true);
    }
    for (const invalid of [
      "",
      "Engineer",
      "2fast",
      "-leading",
      "with space",
      "engineer implement the thing",
      'engineer"; id; #',
      "engineer$(id)",
      "../../etc/passwd",
      "engineer\nreviewer",
    ]) {
      expect(isAgentName(invalid), invalid).toBe(false);
    }
  });

  // The pattern is embedded in a bash `[[ =~ ]]` test in the generated runner
  // workflow and in three tag regexes, so it has to stay a plain character
  // class: no anchors, no groups, no escapes that only mean something to one of
  // those three engines.
  test("is exported as a bare pattern body the bash and tag consumers can embed", async () => {
    const { AGENT_NAME_PATTERN } = await import("./agent-name.ts");
    expect(AGENT_NAME_PATTERN).toBe("[a-z][a-z0-9-]*");
  });
});

describe("tags.ts", () => {
  // Pure, no `gh` involved -- safe to test in-process directly.
  test("PARENT_TAG round-trips with the canonical numeric format", async () => {
    const { PARENT_TAG } = await import("./tags.ts");
    const written = PARENT_TAG.write(42);
    expect(written).toBe("<!-- atomaton:parent=42 -->");
    expect(PARENT_TAG.read(`intro\n${written}\nmore text`)).toBe(42);
    expect(PARENT_TAG.read("<!-- atomaton:parent=#42 -->")).toBeUndefined();
  });

  test("PARENT_ISSUE_TAG and readAnyParentTag", async () => {
    const { PARENT_ISSUE_TAG, readAnyParentTag } = await import("./tags.ts");
    expect(PARENT_ISSUE_TAG.write(7)).toBe("<!-- atomaton:parent-issue=7 -->");
    expect(readAnyParentTag("<!-- atomaton:parent-issue=7 -->")).toBe(7);
    expect(readAnyParentTag("<!-- atomaton:parent=8 -->")).toBe(8);
    expect(readAnyParentTag("no tags here")).toBeUndefined();
  });

  test("AGGREGATED_TAG idempotency marker", async () => {
    const { AGGREGATED_TAG } = await import("./tags.ts");
    const marker = AGGREGATED_TAG.write(9);
    expect(marker).toBe("<!-- atomaton:aggregated=9 -->");
    expect(AGGREGATED_TAG.has(`some comment\n${marker}`)).toBe(true);
    expect(AGGREGATED_TAG.has("some other comment")).toBe(false);
  });

  test("LLM_CONTEXT_TAG marks human-visible notifications for exclusion", async () => {
    const { LLM_CONTEXT_TAG } = await import("./tags.ts");
    const marker = LLM_CONTEXT_TAG.write("exclude");
    expect(marker).toBe("<!-- atomaton:llm-context=exclude -->");
    expect(LLM_CONTEXT_TAG.read(`${marker}\nAtomaton: operation started.`)).toBe("exclude");
  });
});

describe("mcp-tool schema helpers", () => {
  test("positiveInt accepts a number and its string form, rejecting non-integers", async () => {
    const { positiveInt } = await import("./mcp-tool.ts");
    const schema = positiveInt("issue number");

    expect(schema.parse(185)).toBe(185);
    expect(schema.parse("185")).toBe(185);

    for (const bad of ["abc", "", 0, -1, 1.5, "1.5", null, {}]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  test("stringArray accepts an array and wraps a bare string", async () => {
    const { stringArray } = await import("./mcp-tool.ts");
    const schema = stringArray("label names");

    expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(schema.parse("a")).toEqual(["a"]);

    for (const bad of [5, [1], null, {}]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  // Measured on a real run, three times in a row:
  //
  //   Tool error for get_issue: Unrecognized key(s) in object: 'issue_number'
  //
  // `issue_number` is what the GitHub REST API calls it, so a model has seen it
  // far more often than a bare `number`. Before schemas became strict, zod dropped
  // the unknown key and the defaulted `number` filled in, so these silently
  // worked. Strictness surfaced them by refusing the call outright.
  describe("a synonym for `number` is accepted", () => {
    const tool = async () => {
      const { defineMcpTool, positiveInt, z } = await import("./mcp-tool.ts");
      return defineMcpTool({
        name: "probe",
        description: "probe",
        schema: z.object({ number: positiveInt("n").optional(), from: positiveInt("f").optional() }),
        handler: (a) => JSON.stringify(a),
      });
    };

    test("every alias arrives as `number`", async () => {
      const t = await tool();
      for (const alias of ["issue_number", "pr_number", "pull_number", "pull_request_number"]) {
        const { text } = await t.call({ [alias]: 42 });
        expect(JSON.parse(text), alias).toEqual({ number: 42 });
      }
    });

    // The explicit one wins. An alias must never silently override a value the
    // caller actually named.
    test("an explicit `number` is not overridden", async () => {
      const t = await tool();
      const { text } = await t.call({ number: 7, issue_number: 42 });
      expect(JSON.parse(text)).toEqual({ number: 7 });
    });

    // The point of strictness stands: a MISSPELLING is a different call that must
    // not succeed. `form` for `from` returned the default window and the agent
    // read it as the range it asked for.
    test("a misspelling is still refused", async () => {
      const t = await tool();
      await expect(t.call({ number: 1, form: 3 })).rejects.toThrow(/form/);
    });

    // And the advertised schema stays strict, so the constraint still reaches the
    // model before the call rather than after.
    test("the alias is not advertised", async () => {
      const t = await tool();
      expect(JSON.stringify(t.tool.inputSchema)).not.toContain("issue_number");
      expect(JSON.stringify(t.tool.inputSchema)).toContain("additionalProperties");
    });
  });

  // A lenient runtime must not cost us a precise contract: zod-to-json-schema
  // silently emits `{}` for schemas built the wrong way (see mcp-tool.ts's
  // header), which would leave the model with no shape at all to follow.
  test("helpers still advertise a precise JSON Schema", async () => {
    const { positiveInt, stringArray } = await import("./mcp-tool.ts");
    const { zodToJsonSchema } = await import("zod-to-json-schema");

    const numberSchema = zodToJsonSchema(positiveInt("issue number"), {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    expect(numberSchema.type).toBe("integer");
    expect(numberSchema.description).toBe("issue number");

    const labelsSchema = zodToJsonSchema(stringArray("label names"), {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, any>;
    expect(labelsSchema.type).toBe("array");
    expect(labelsSchema.items.type).toBe("string");
  });
});

/**
 * `resolveBranch` answers "which branch is this run on", and every route has to
 * answer with a branch.
 *
 * It used to hand back whatever git printed. On a detached HEAD that is git's own
 * pseudo-entry, `(HEAD detached at pull/802/head)` -- `--format` does not suppress
 * it -- and `commit_and_push` passed it straight to `git push -u origin <that>`,
 * which answered `fatal: invalid refspec`. Two runs lost their commits to it (#247,
 * #803): an agent reading a raw git failure concludes the tool is broken, not that
 * its checkout has no branch to publish.
 *
 * A real repository, because the question is what git says -- the pseudo-entry is
 * git's output and a faked `git` would only assert this file's own idea of it.
 */
describe("branch-placement.ts resolveBranch", () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }

  /** A repository with one commit on a real branch, and git identity configured. */
  function makeRepo(): { root: string; repo: string } {
    const root = mkdtempSync(join(tmpdir(), "atomaton-resolve-branch-"));
    const repo = join(root, "repo");
    git(root, "init", "--initial-branch=main", repo);
    git(repo, "config", "user.name", "Atomaton Test");
    git(repo, "config", "user.email", "atomaton@example.com");
    writeFileSync(join(repo, "value.txt"), "one\n");
    git(repo, "add", "value.txt");
    git(repo, "commit", "-m", "initial");
    return { root, repo };
  }

  /** Calls `resolveBranch` in a subprocess whose cwd is `cwd`, and reports which way it went. */
  function resolveIn(cwd: string, env: Record<string, string>): { ok?: string; error?: string } {
    const { file, dir } = makeShim(`
      import { resolveBranch } from "${importable(join(LIB_DIR, "branch-placement.ts"))}";
      try {
        console.log(JSON.stringify({ ok: resolveBranch() }));
      } catch (e) {
        console.log(JSON.stringify({ error: (e as Error).message }));
      }
    `);
    try {
      return JSON.parse(runWithFakeGh(file, [], { cwd, env }).stdout.trim()) as { ok?: string; error?: string };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("BRANCH naming a real branch is the answer", () => {
    const { root, repo } = makeRepo();
    try {
      git(repo, "branch", "atomaton/issue-808");
      expect(resolveIn(repo, { BRANCH: "atomaton/issue-808" }).ok).toBe("atomaton/issue-808");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("on a real branch, HEAD names it", () => {
    const { root, repo } = makeRepo();
    try {
      expect(resolveIn(repo, { BRANCH: "" }).ok).toBe("main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The `--points-at` route exists for exactly this: a detached HEAD that genuinely
   * sits at a branch tip, where the branch is the name the work belongs on. It must
   * keep answering, or the fix for the pseudo-entry would break the case the route
   * was written for. (`main` is deleted here so that only one branch points at the
   * commit -- with several, which one answers is git's listing order, and the route
   * is a fallback rather than a place to resolve that.)
   */
  test("a detached HEAD at a branch tip still answers with that branch", () => {
    const { root, repo } = makeRepo();
    try {
      git(repo, "branch", "atomaton/issue-808");
      git(repo, "checkout", "--detach", "HEAD");
      git(repo, "branch", "-D", "main");
      // The pseudo-entry is printed here too, and is what must be skipped.
      const listing = git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD").split("\n");
      expect(listing[0]).toStartWith("(");
      expect(listing).toContain("atomaton/issue-808");
      expect(resolveIn(repo, { BRANCH: "" }).ok).toBe("atomaton/issue-808");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The reported failure, reproduced: a checkout detached at a fetched pull-request
   * head, with no local branch pointing at it -- what a `pr` run has. `git branch
   * --points-at HEAD` prints `(HEAD detached at pull/802/head)` and nothing else,
   * and that description used to be returned as though it were a branch name.
   */
  test("a detached-HEAD description is never returned, and the refusal names the state", () => {
    const { root, repo } = makeRepo();
    try {
      git(repo, "update-ref", "refs/remotes/pull/802/head", git(repo, "rev-parse", "HEAD"));
      git(repo, "checkout", "--detach", "refs/remotes/pull/802/head");
      // No local branch at this commit, so the pseudo-entry is all git prints.
      git(repo, "branch", "-D", "main");
      expect(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")).toBe(
        "(HEAD detached at pull/802/head)",
      );

      const r = resolveIn(repo, { BRANCH: "HEAD" });
      expect(r.ok, "the pseudo-entry was returned as a branch name").toBeUndefined();
      // What the agent needs to know: this run has no branch to push. Not a refspec
      // error, which reads as the tool being broken.
      expect(r.error).toContain("detached checkout with no local branch");
      expect(r.error).toContain("no branch to push");
      expect(r.error).not.toContain("refspec");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** `BRANCH` is set by the runner, so a stale or wrong value must not be trusted either. */
  test("a BRANCH value that is not a local branch falls through to git", () => {
    const { root, repo } = makeRepo();
    try {
      expect(resolveIn(repo, { BRANCH: "atomaton/issue-808" }).ok, "a branch that does not exist").toBe("main");
      expect(resolveIn(repo, { BRANCH: "(HEAD detached at pull/802/head)" }).ok).toBe("main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no branch at all, and no BRANCH: the refusal rather than an empty string", () => {
    const { root, repo } = makeRepo();
    try {
      git(repo, "checkout", "--detach", "HEAD");
      git(repo, "branch", "-D", "main");
      const r = resolveIn(repo, { BRANCH: "" });
      expect(r.ok).toBeUndefined();
      expect(r.error).toContain("no branch to push");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("issue-branches.ts collectIssueBranches", () => {
  const REFS = JSON.stringify([{ ref: "refs/heads/atomaton/issue-12" }, { ref: "refs/heads/atomaton/issue-12-2" }]);

  function run(rules: FakeGhRule[]) {
    const configDir = makeConfigDir({});
    const { file, dir } = makeShim(`
      import { collectIssueBranches } from "${importable(join(LIB_DIR, "issue-branches.ts"))}";
      console.log(JSON.stringify(collectIssueBranches("owner/repo", 12)));
    `);
    try {
      return runWithFakeGh(file, [], { cwd: configDir, rules });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The merged flag decides whether a run resumes a branch or starts a new one,
  // and asking for it by head branch is what keeps that answer correct in a
  // repository with more pull requests than one page holds -- scanning the
  // repository's own list would read anything older than the first page as
  // unmerged and resume a branch whose commits are already released.
  test("asks about merged state per head branch, never as one repository-wide list", () => {
    const r = run([
      { match: ["matching-refs/heads/atomaton/issue-12"], stdout: REFS },
      { match: ["head=owner:atomaton/issue-12-2"], stdout: "[]" },
      { match: ["head=owner:atomaton/issue-12"], stdout: JSON.stringify([{ merged_at: "2026-01-01T00:00:00Z" }]) },
    ]);

    expect(JSON.parse(r.stdout.trim())).toEqual([
      { name: "atomaton/issue-12", merged: true },
      { name: "atomaton/issue-12-2", merged: false },
    ]);
    for (const call of r.ghCalls) {
      const pulls = call.find((arg) => arg.includes("/pulls?"));
      if (pulls) expect(pulls).toContain("head=owner:");
    }
  });

  // A run that cannot see the branches has to start from the base branch, not
  // fail before the agent has said anything.
  test("reports no branches when the ref listing fails", () => {
    const r = run([{ match: ["matching-refs"], code: 1 }]);
    expect(JSON.parse(r.stdout.trim())).toEqual([]);
  });

  test("treats a branch whose pull requests cannot be read as unmerged", () => {
    const r = run([
      { match: ["matching-refs/heads/atomaton/issue-12"], stdout: JSON.stringify([{ ref: "refs/heads/atomaton/issue-12" }]) },
      { match: ["head=owner:atomaton/issue-12"], code: 1 },
    ]);
    expect(JSON.parse(r.stdout.trim())).toEqual([{ name: "atomaton/issue-12", merged: false }]);
  });
});

describe("issue-images.ts extractImageUrls", () => {
  test("finds a markdown image", () => {
    const urls = extractImageUrls("see ![shot](https://github.com/user-attachments/assets/abc) here");
    expect(urls).toEqual(["https://github.com/user-attachments/assets/abc"]);
  });

  // People paste this spelling when they want to set a width.
  test("finds an html image", () => {
    expect(extractImageUrls('<img src="https://example.com/a.png" width="400">')).toEqual([
      "https://example.com/a.png",
    ]);
  });

  test("returns nothing for a body with no image", () => {
    expect(extractImageUrls("just text, and a [link](https://example.com)")).toEqual([]);
  });

  test("keeps each url once", () => {
    const body = "![a](https://x/1.png)\n![b](https://x/1.png)";
    expect(extractImageUrls(body)).toEqual(["https://x/1.png"]);
  });

  // A body with thirty screenshots would otherwise put thirty images into every
  // later inference of that run.
  test("caps how many it takes", () => {
    const body = Array.from({ length: 9 }, (_, i) => `![](https://x/${i}.png)`).join("\n");
    expect(extractImageUrls(body).length).toBe(4);
  });
});

describe("issue-images.ts sniffMimeType", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(12).fill(0)]);

  // The case that made this necessary: GitHub serves an attachment from
  // `user-attachments/assets/<uuid>`, which has no extension. A real one turned
  // out to be a JPEG, and the URL said nothing.
  test("reads the format from the bytes, not the name", () => {
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(sniffMimeType(bytes(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
  });

  test("recognises webp by both of its markers", () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffMimeType(webp)).toBe("image/webp");
    // RIFF alone is a container, not necessarily an image.
    expect(sniffMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0, 0, 0, 0]))).toBe("");
  });

  // Better to skip an attachment than to announce a format that is not there.
  test("says nothing for bytes that are not a known image", () => {
    expect(sniffMimeType(bytes(0x25, 0x50, 0x44, 0x46))).toBe("");
    expect(sniffMimeType(new Uint8Array())).toBe("");
  });
});

/**
 * A failure from the far end is not an answer, and the difference decides whether a
 * run dies.
 *
 * One `HTTP 504` on a pull request lookup ended a run -- the reviewer never
 * started, and a red check appeared for a defect in neither the code nor the
 * machinery. What must NOT be retried matters just as much: a 404 is an answer, and
 * retrying it would turn a clear failure into three of them.
 */
describe("gh.ts looksTransient", () => {
  const failure = (stderr: string) => ({ code: 1, stdout: "", stderr });

  test("the far end failing is not an answer", () => {
    expect(looksTransient(failure("gh: HTTP 504")), "the failure that ended a run on #427").toBe(true);
    expect(looksTransient(failure("gh: HTTP 502 Bad Gateway"))).toBe(true);
    expect(looksTransient(failure("HTTP 429 rate limit exceeded")), "429 asks for a wait").toBe(true);
    expect(looksTransient(failure("dial tcp: i/o timeout"))).toBe(true);
    expect(looksTransient(failure("unexpected EOF"))).toBe(true);
  });

  test("a refusal IS an answer, and repeating the question does not change it", () => {
    expect(looksTransient(failure("gh: Not Found (HTTP 404)"))).toBe(false);
    expect(looksTransient(failure("gh: HTTP 403 Resource not accessible by integration"))).toBe(false);
    expect(looksTransient(failure("gh: HTTP 422 Validation Failed"))).toBe(false);
    expect(looksTransient(failure("unknown flag: --nope"))).toBe(false);
  });

  // A status code, not any digits that begin with one.
  test("reads a status code and not a longer number that starts with one", () => {
    expect(looksTransient(failure("gh: HTTP 500"))).toBe(true);
    expect(looksTransient(failure("gh: HTTP 5001"))).toBe(false);
  });
});

/**
 * The measured failure this fixes: an agent called `shell__execute`, was told
 * only `Unknown: execute`, and made the same mistake three times. The one place that
 * knew the right name was the dispatch map, and nothing asked it.
 */
describe("what a server says about a tool it does not have", () => {
  test("the near miss comes first, because that is what happened", () => {
    const message = unknownToolMessage("execute", ["shell_execute"]);
    expect(message).toContain("Did you mean 'shell_execute'?");
    expect(message.indexOf("Did you mean")).toBeLessThan(message.indexOf("Available"));
  });

  test("with no near miss, the list is still there", () => {
    const message = unknownToolMessage("nonsense", ["read_file", "write_file"]);
    expect(message).not.toContain("Did you mean");
    expect(message).toContain("Available: read_file, write_file.");
  });

  test("the name that was asked for is named, so a log says which call failed", () => {
    expect(unknownToolMessage("execute", ["shell_execute"])).toContain("'execute'");
  });

  /** Two candidates contain the name; guessing one of them would be worse than both. */
  test("several near misses are all offered", () => {
    const message = unknownToolMessage("read", ["read_file", "read_media_file", "write_file"]);
    expect(message).toContain("'read_file' or 'read_media_file'");
  });
});

/**
 * `git commit` with a clean tree exits non-zero, and `commit_and_push` treated that
 * as a failure and stopped -- skipping the push that still had work to do. It cost 23
 * recorded failures, and in the sessions where the agent had committed through the
 * shell first, it meant the commit never reached origin.
 */
describe("nothingToCommit", () => {
  const result = (stdout: string, stderr = "") => ({ code: 1, stdout, stderr });

  test("recognises a clean tree", () => {
    expect(nothingToCommit(result("On branch atomaton/issue-104\nnothing to commit, working tree clean"))).toBe(true);
  });

  test("recognises unstaged changes that were never added", () => {
    expect(nothingToCommit(result("no changes added to commit (use \"git add\")"))).toBe(true);
  });

  /** A real failure must stay a failure, or a broken hook would look like a clean tree. */
  test("a hook rejecting the commit is not a clean tree", () => {
    expect(nothingToCommit(result("", "pre-commit hook failed"))).toBe(false);
  });
});

/**
 * The question this asks GitHub decides which numbers it can answer for.
 *
 * It asked `issue(number:)`, which resolves only an issue: a pull request's number came
 * back null with a NOT_FOUND error, so every caller passing one got empty links and a
 * message that read like GitHub being unwell. Measured against the live API — "Could
 * not resolve to an Issue with the number of 826" for a pull request that exists and is
 * merged.
 */
describe("issue-links.ts issueLinks", () => {
  function links(payload: unknown) {
    const { file, dir } = makeShim(`
      import { issueLinks } from "${importable(join(LIB_DIR, "issue-links.ts"))}";
      console.log(JSON.stringify(issueLinks("owner/repo", 826)));
    `);
    try {
      const r = runWithFakeGh(file, [], {
        rules: [{ match: ["api", "graphql"], stdout: JSON.stringify(payload) }],
      });
      return JSON.parse(r.stdout || "{}") as {
        parent?: { number: number };
        children: { number: number }[];
        pullRequests: { number: number }[];
        unavailable?: string;
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The defect, as a pull request meets it. A pull request has no parent field and no
   * sub-issues; what it has is the issue it closes, which is its parent in the sense
   * `domain/work-tree.ts` means — a pull request is a leaf.
   */
  test("a pull request's number answers with the issue it closes", () => {
    const result = links({
      data: {
        repository: {
          issueOrPullRequest: {
            __typename: "PullRequest",
            closingIssuesReferences: { nodes: [{ number: 803, title: "parent", state: "CLOSED" }] },
          },
        },
      },
    });
    expect(result.parent?.number).toBe(803);
    expect(result.children).toEqual([]);
    expect(result.pullRequests).toEqual([]);
    // The half that made this hard to see: empty links with no `unavailable` read as
    // "this really has none", which is what a reviewer acted on.
    expect(result.unavailable).toBeUndefined();
  });

  test("an issue still answers with its children and its pull requests", () => {
    const result = links({
      data: {
        repository: {
          issueOrPullRequest: {
            __typename: "Issue",
            parent: null,
            subIssues: { nodes: [{ number: 807, title: "child", state: "CLOSED" }] },
            closedByPullRequestsReferences: {
              nodes: [{ number: 826, title: "pr", state: "MERGED", merged: true, body: "" }],
            },
            timelineItems: { nodes: [] },
          },
        },
      },
    });
    expect(result.children.map((c) => c.number)).toEqual([807]);
    expect(result.pullRequests.map((p) => p.number)).toEqual([826]);
  });

  /** A number that names nothing is its own answer, and not an empty set of links. */
  test("a number that is neither says so rather than answering empty", () => {
    const result = links({ data: { repository: { issueOrPullRequest: null } } });
    expect(result.unavailable).toContain("was not found");
  });
});
