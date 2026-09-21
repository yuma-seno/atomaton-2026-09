#!/usr/bin/env bun
/**
 * post_result_comment.ts — Post the agent's final output as a GitHub
 * comment, including token usage and (when nothing further will
 * happen automatically) a mention.
 *
 * Reads atomaton_output.txt (required) and atomaton_logs.txt (optional, for the
 * ATOMA_TOKEN_USAGE: line) from the current directory.
 *
 * Usage:
 *   post_result_comment.ts --number N --agent NAME [--notify LOGIN]
 *     [--directive NAME] [--chain-continues true|false]
 *     [--ended-because completed|runtime|iterations|stopped] --run-url URL
 * Writes `comment_id=<id>` to $GITHUB_OUTPUT.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh } from "../../adapters/github/gh.ts";
import { AGENT_TAG, CHANGED_TAG, ENDED_TAG } from "../../adapters/github/tags.ts";
import { parentIssueOf } from "../../adapters/github/parent-issue.ts";
import { shouldMentionOnCompletion } from "../../domain/work/completion-mention.ts";
import { endingOf, type TurnEnding } from "../../domain/work/turn.ts";
import { redact } from "../../shared/redaction.ts";
import { renderTokenLine } from "../../domain/record/token-line.ts";
import { toolTroubleLine } from "../../domain/record/tool-trouble.ts";
import { escapedMentionNotice, escapeUnknownMentions } from "../../domain/work/mention.ts";
import { knownParticipants } from "../../adapters/github/participants.ts";
import type { Session } from "../../domain/work/session.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface PostResultCommentArgs {
  number: string | number;
  agent: string;
  type?: string;
  notify?: string;
  directive?: string;
  "chain-continues"?: string;
  /** How the core says the run ended. See `read_run_ending.ts`. */
  "ended-because"?: string;
  /**
   * Whether the run left a report, read off the session by `read_run_ending.ts`.
   *
   * Not derived here from `--output` being empty, though that is right there. The
   * output file is empty for every session-ending tool call as well — `create_pr`,
   * `launch_sub_agent`, `request_close_issue` all stop atoma's loop before the model
   * gets another turn — so reading it that way would call a hand-off silent. The
   * session says which of the two happened; this carries that answer.
   */
  reported?: string;
  "messages-before"?: string | number;
  /** "true" when this run pushed a commit, opened a pull request, or merged one. */
  changed?: string;
  /**
   * The session, read only to salvage something when the run ran out of iterations.
   *
   * Optional: a run that ends normally never opens it.
   */
  session?: string;
  "run-url": string;
  /**
   * The agent's stdout, and the log it wrote alongside.
   *
   * Arguments rather than the bare names this used to open. Those were relative
   * paths, correct only while the run's files sat in the repository root -- they
   * moved them to `$RUNNER_TEMP/atomaton-run` and every result comment since was
   * silently dropped, because `existsSync("atomaton_output.txt")` was false and the
   * skip branch reads exactly like a session that ended via a tool call.
   *
   * Two full releases went out that way. The step reported success, the agent wrote
   * its report -- 3,914 characters in the run that found this -- and nobody received
   * it.
   */
  output: string;
  "logs-file": string;
}

export const ref = defineScript<PostResultCommentArgs>(import.meta.url);

/**
 * The token counts the run reported, and deliberately no money.
 *
 * This used to multiply the counts by a hardcoded `0.15 / 0.6` per million and
 * print an `Estimated cost`. That number could not be right, for three reasons
 * at once, pulling in different directions:
 *
 *   1. The rate was one model's, applied to every model. It matched no model
 *      any agent here runs — the three agents are on three different ones.
 *   2. `prompt` is not the input total. Providers report the tokens that missed
 *      the cache, so a cached prefix is absent from the number entirely.
 *   3. Whatever `prompt` did contain was charged at the full uncached rate,
 *      though most of it is cache reads at a fraction of that.
 *
 * The errors did not even share a sign, so the printed figure could not be
 * called high or low — only meaningless. A confident wrong number is worse than
 * no number, so it is gone.
 *
 * Getting it right needs one of two things, and neither is wanted here. A price
 * table is configuration that silently goes stale and then produces confident
 * wrong numbers again — the state this is leaving. Reading the real charge from
 * the provider works, but only one of the four providers Atoma supports reports
 * one at all: OpenRouter returns `usage.cost`, while OpenAI and Anthropic report
 * tokens only, and GitHub Copilot bills per request rather than per token, so
 * the figure does not exist there even in principle.
 *
 * So: tokens, which every provider reports and which are a measurement rather
 * than a derivation. Add money here only when it arrives from the provider as
 * money.
 */
function tokenUsageLines(logsFile: string): string[] {
  if (!existsSync(logsFile)) return [];
  const usageLine = readFileSync(logsFile, "utf8")
    .split("\n")
    .find((l) => l.includes("ATOMA_TOKEN_USAGE:"));
  if (!usageLine) return [];

  const prompt = /prompt=(\d+)/.exec(usageLine)?.[1];
  const completion = /completion=(\d+)/.exec(usageLine)?.[1];
  const total = /total=(\d+)/.exec(usageLine)?.[1];
  // Atoma prints `cached=unknown` when no inference reported one, and this clause
  // is then absent rather than zero. Zero is a claim that the cache did nothing;
  // absent says the provider never told us, and the two want opposite responses.
  // The digits-only pattern is what makes `unknown` fall through to absent.
  const cached = /cached=(\d+)/.exec(usageLine)?.[1];

  return ["", "---", renderTokenLine({ total, prompt, completion, cached })];
}

/**
 * Whether this issue is an agent-created sub-task, and whether it is closed.
 *
 * Both answers come from one read, and a failed read answers "no" — a run
 * mentioning a person it need not have is a smaller harm than a run that
 * silently drops the only signal that work has stopped.
 *
 * Skipped entirely for a pull request run: `--number` is a PR number there, and
 * `gh issue view` on one is an error rather than an answer.
 */
function subIssueState(number: string, type?: string): { isSubIssue: boolean; issueClosed: boolean } {
  if (type !== "issue") return { isSubIssue: false, issueClosed: false };
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const { code, stdout } = gh("issue", "view", number, "--repo", repo, "--json", "state");
  if (code !== 0) return { isSubIssue: false, issueClosed: false };
  let issueClosed = false;
  try {
    issueClosed = (JSON.parse(stdout) as { state?: string }).state === "CLOSED";
  } catch {
    return { isSubIssue: false, issueClosed: false };
  }
  // GitHub's own link, like every other reader of this relationship. The body's
  // `atomaton:parent` tag is gone -- it recorded the parent at creation and nothing
  // rewrote it. `known: false` falls in with the rest of this function's failures:
  // the two facts here only decide whether one extra sentence appears in a comment.
  const found = parentIssueOf(repo, Number(number));
  return { isSubIssue: found.known && found.parent > 0, issueClosed };
}

/**
 * The last thing the agent actually said, out of the session.
 *
 * For the iteration-limit case only. Walks backwards for an assistant message with
 * text, because the last few turns of a run that ran out are tool calls with no
 * words -- which is why the output file was empty in the first place.
 *
 * **And for the models this repository runs today, it finds nothing.** Measured over
 * 244 stored sessions after this was written: these agents write prose exactly once,
 * in their final turn (450 assistant turns, 1 with text; 204 turns, 1; 200 turns, 0).
 * When the loop ends the turn before that, there is nothing earlier to recover. The
 * only place that can produce the report is the inference loop itself, which is
 * the run's own files.
 *
 * Kept rather than removed: it costs nothing when there is nothing, and it works for
 * a model that narrates as it goes. But it is not the fix, and reading it as one
 * would leave the real gap open.
 *
 * `undefined` when there is nothing to salvage, which is a real outcome -- a run that
 * made 324 tool calls and never wrote a sentence has nothing to report, and saying so
 * is better than posting an empty comment.
 */
/**
 * The last thing THIS run said, if it said anything.
 *
 * `from` is where this run's own messages begin -- everything below it was written by
 * an earlier run or is the GitHub context put in front of this one. Without that
 * boundary this walks the whole accumulated session and finds the previous run's
 * final report, which it then publishes under a warning saying "this run ended before
 * it wrote a report, below is the last thing it said, from the middle of the work".
 * Every clause of that is false about the text it shows.
 *
 * Measured: a run stopped after 19 iterations republished the previous run's
 * complete conclusion. It is easy to reach because these models write prose exactly
 * once, in their final turn -- so a run that is stopped has no assistant text of its
 * own at all, and the newest one in the session always belongs to somebody else.
 *
 * An absent or unreadable boundary salvages nothing. The failure of showing a person
 * less than they could have had is smaller than the failure of showing them an old
 * conclusion labelled as a new fragment.
 */
/**
 * The session, or nothing.
 *
 * Every failure here is silent on purpose. The comment is the thing that has to go
 * out; what is read from the session -- the salvaged last message, the count of what
 * the tools did -- is an addition to it and never a precondition for it.
 */
function readSession(path: string | undefined): Session | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Session;
  } catch {
    return undefined;
  }
}

export function lastAgentText(sessionPath: string | undefined, from?: number): string | undefined {
  if (from === undefined || !Number.isFinite(from)) return undefined;
  const messages = readSession(sessionPath)?.messages ?? [];
  for (let i = messages.length - 1; i >= from; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string" && content.trim() !== "") return content;
  }
  return undefined;
}

/**
 * The ending as `atomaton:ended` spells it: what `/resume` asks the thread.
 *
 * `stopped` is the only value with a reader — `lastEnding` compares against it —
 * so the rest collapse to "not interrupted". Kept as its own function so the
 * projection is visible rather than inlined into a tag write.
 *
 * Written as an exhaustive switch rather than the two-line `if` it was, so that
 * adding an ending is a type error here instead of a silent landing on `done`. That
 * silence is what `no-report` cost: it reached this projection as "not stopped, not
 * spent" and was filed with the runs that finished.
 *
 * `no-report` still answers `done`, and that is a decision rather than a fall-through.
 * The tag says whether a node was INTERRUPTED, because `/resume` picks the nodes a
 * person can pick up where something left off. A run that reported nothing was not
 * interrupted — it ended believing itself finished — so resuming it would restart an
 * agent with nothing left to do. What that run needs is a person, and the mention
 * below is what fetches one.
 */
function endedTag(ending: TurnEnding): string {
  switch (ending.ended) {
    case "stopped":
      return "stopped";
    case "spent":
      return "limit";
    case "failed":
    case "chain-over":
    case "handed-off":
    case "no-report":
    case "finished":
      return "done";
  }
}

/**
 * How this turn ended, as far as this comment can know.
 *
 * `succeeded` is true by construction: the workflow only runs this step when the
 * agent step succeeded, so there is no failed turn to report from here.
 *
 * `loopLimitReached` is NOT known yet, and cannot be. The chain's own limit is
 * counted from the thread by `manage_dispatch_loop.ts`, which runs after this
 * because the tally includes the comment this is writing. Passing `false` is
 * therefore not a guess:
 *
 *   - it can only turn a `chain-over` into a `handed-off`, and
 *   - both carry the same `next`, which is the only thing read here.
 *
 * So the one signal this cannot see is the one that does not change the answer.
 * Deriving the ending here rather than re-deriving the parts is what removes the
 * two copies this file used to hold — one for the mention, one for the tag.
 */
/** Whether the run ended before it was done, either way round. */
function cutShort(endedBecause: string | undefined): boolean {
  return endedBecause === "stopped" || endedBecause === "runtime" || endedBecause === "iterations";
}

/**
 * How it was cut short, in the words for the person reading the comment.
 *
 * `runtime` and `iterations` are one ending to `turn.ts` — the decisions below it
 * turn on the same answer for either — and two different sentences here, which is
 * why the core's own word travels this far rather than a boolean.
 *
 * This said "ran out of iterations" for both, and the runner passes
 * `--max-runtime-secs` and no `--max-iterations`. So the ceiling it hits is always
 * the clock, and that sentence was always the wrong one.
 */
function howItWasCutShort(endedBecause: string | undefined): string {
  if (endedBecause === "stopped") return "was stopped";
  return endedBecause === "iterations" ? "ran out of iterations" : "ran out of time";
}

/**
 * The sentence that fetches a person, named by how the run actually ended.
 *
 * It used to say "task completed" whatever happened, which no one saw on a stopped
 * run because a stopped run rarely got a mention at all -- and the moment it did, it
 * was telling the person who had just stopped it that it had finished. "Review the
 * results" is dropped for the same reason: a run cut short may have none.
 *
 * `no-report` is the third sentence, and it is here rather than sharing the ordinary
 * one because the ordinary one is the false claim this change exists to stop making.
 * A run that produced no closing text has no results to review; what it did is in a
 * saved session, and the person is being told so they can go and look.
 */
function mentionLine(
  ending: TurnEnding,
  args: { agent: string; notify?: string; endedBecause?: string },
): string {
  if (cutShort(args.endedBecause)) {
    return (
      `@${args.notify} — **${args.agent}** ${howItWasCutShort(args.endedBecause)} ` +
      `before it finished, and no agent will run next. Resume it, or say what to do instead.`
    );
  }
  if (ending.ended === "no-report") {
    return (
      `@${args.notify} — **${args.agent}** ended without writing a report. Nothing interrupted it ` +
      `and nothing runs next; it simply left no closing text, so there is nothing here to review. ` +
      `What it did is in its saved session.`
    );
  }
  return `@${args.notify} — **${args.agent}** task completed. No agent will be automatically executed next. Please review the results or provide instructions for the next step.`;
}

function endingHere(args: {
  directive?: string;
  chainContinues?: string;
  endedBecause?: string;
  reported?: boolean;
}): TurnEnding {
  return endingOf({
    succeeded: true,
    endedBecause: args.endedBecause ?? "",
    loopLimitReached: false,
    chainContinues: args.chainContinues === "true",
    directive: args.directive ?? "",
    reported: args.reported === true,
  });
}

export function buildCommentBody(args: {
  agent: string;
  notify?: string;
  directive?: string;
  chainContinues?: string;
  endedBecause?: string;
  /**
   * Whether the run left a report — its last assistant message had words in it.
   *
   * Absent means it did not, which is the direction that speaks up: an unobserved run
   * is treated as one that said nothing, and the cost of being wrong is one mention
   * too many rather than a silent run filed as a success.
   */
  reported?: boolean;
  runUrl: string;
  /** `owner/name`, for linking to the metrics report. Absent when unknown. */
  repo?: string;
  output: string;
  usageLines: string[];
  isSubIssue?: boolean;
  issueClosed?: boolean;
  /** Logins the agent wrote as mentions that were escaped instead. */
  escapedMentions?: readonly string[];
  /**
   * Whether `output` is the agent's last message rather than its report.
   *
   * Said in the comment, because presenting a sentence from the middle of the work
   * as a conclusion is worse than posting nothing: a reader would act on it.
   */
  salvaged?: boolean;
  /**
   * Whether the run was cut short having said nothing at all, so `output` is this
   * file's own sentence rather than anything the agent produced.
   *
   * The common shape rather than the odd one: a stop lands at the next turn
   * boundary, so a run in the middle of reading files when it arrives has no text
   * and nothing to salvage either.
   */
  wroteNothing?: boolean;
  /**
   * Whether this run pushed a commit, opened a pull request or merged one.
   *
   * Written into the comment because that is where the next run can read it.
   * `domain/work/progress.ts` counts consecutive runs that changed nothing, and it
   * counts them from the thread rather than from a counter -- so the thread has to
   * carry the fact.
   */
  changed?: boolean;
  /**
   * What the tools did to this run, counted from its session by `tool-trouble.ts`.
   *
   * Measured over 396 sessions (#940): 30 runs carried a problem a server reported
   * about itself and 3 said so; 107 carried a refused or errored call and 33 said so.
   * The prompt asks for all of it by name, so what is left is to stop asking and
   * count -- and the count belongs in the footer, where every other thing the machine
   * knows about the run already is, rather than in the agent's text where a reader
   * would take it for something the agent chose to say.
   *
   * Absent when there was none, which is the ordinary run.
   */
  toolTrouble?: string;
}): string {
  // Once, and asked twice below. It was derived twice, which is one derivation more
  // than there are facts.
  const ending = endingHere(args);

  const lines = [
    AGENT_TAG.write(args.agent),
    CHANGED_TAG.write(args.changed === true ? "yes" : "no"),
    // How this run ended, so the thread can be asked later. `/resume` over a work tree
    // needs to know which nodes under the one it was given were interrupted, and the
    // alternative -- "has a saved session" -- is true of every node that ever ran.
    //
    // Three wire values rather than the domain's seven, because this tag answers one
    // question and `/resume` is its only reader. A projection, taken from the ending
    // rather than re-derived from the signals beside it -- which is what it was, in
    // this same file, twelve lines from the other copy.
    ENDED_TAG.write(endedTag(ending)),
  ];
  if (args.salvaged === true) {
    lines.push(
      "> [!WARNING]",
      "> This run ended before it wrote a report. Below is the last thing it said,",
      "> from the middle of the work — not a conclusion, and not a summary of what it found.",
      "",
    );
  } else if (args.wroteNothing === true) {
    // The run said nothing at all, so there is not even a middle to show. Said
    // outright, because a comment with no report in it otherwise reads as a run that
    // finished and had nothing to say.
    lines.push(
      "> [!WARNING]",
      "> This run ended before it said anything at all, so there is no report below —",
      "> not even a partial one. What it had done is in its saved session.",
      "",
    );
  }
  lines.push(args.output, "", ...args.usageLines);

  // Directly under what the agent wrote, because that is what it is about, and
  // above the run footer, which nobody reads for this.
  const escapedNotice = escapedMentionNotice(args.escapedMentions ?? []);
  if (escapedNotice !== undefined) lines.push("", escapedNotice, "");

  if (
    shouldMentionOnCompletion({
      ending,
      chainContinues: args.chainContinues === "true",
      notify: args.notify,
      isSubIssue: args.isSubIssue ?? false,
      issueClosed: args.issueClosed ?? false,
    })
  ) {
    lines.push(mentionLine(ending, args), "");
  }

  // The report, one click from the run that is reporting. It is written after this
  // comment is posted, so the link is to the branch tip rather than to a commit --
  // which is what somebody following it wants anyway: the current state, including
  // this run. A permalink would show the metrics as they were a moment before.
  //
  // Omitted rather than guessed when the repository is unknown, because a broken link
  // in every comment is worse than no link at all.
  const metrics = args.repo
    ? ` · [metrics](https://github.com/${args.repo}/blob/atomaton-data/metrics/report.md)`
    : "";
  lines.push("---", `_run by [${args.agent}](${args.runUrl})${metrics}_`);
  // Under the run link and above the notice saying how to continue: this is a fact
  // about the run, the notice is the action, and the action reads last.
  //
  // No `⚠️`, in the same voice as the token line and the run link above it. The
  // marker means one thing in this footer -- the run was cut off and a person has to
  // continue it -- and this line is not that. Most of what it counts is a guard doing
  // its job, which `looksRefused` exists to distinguish from a tool breaking;
  // measured, 107 of 396 runs carried a refused or errored call, so a warning sign
  // here would appear on a quarter of all comments and the one below it would stop
  // being read. The line's job is to make the count impossible to lose, not to claim
  // a fault.
  if (args.toolTrouble !== undefined) lines.push(`_${args.toolTrouble}_`);
  if (args.endedBecause === "stopped") {
    // Says the session survived, because that is the whole difference between this
    // and cancelling the job, and the person who stopped it cannot tell from here
    // which one they got.
    lines.push(
      `⏸️ _Stopped on request. **The session is saved.** Comment \`/resume\` to continue ` +
        `from here, or \`/${args.agent}\` with an instruction on the following lines._`,
    );
  } else if (cutShort(args.endedBecause)) {
    lines.push(`⚠️ _The run ${howItWasCutShort(args.endedBecause)}. Comment \`/${args.agent}\` to continue._`);
  }

  return lines.join("\n");
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      agent: { type: "string" },
      type: { type: "string" },
      notify: { type: "string" },
      directive: { type: "string" },
      "chain-continues": { type: "string" },
      "ended-because": { type: "string" },
      reported: { type: "string" },
      "messages-before": { type: "string" },
      "run-url": { type: "string" },
      changed: { type: "string" },
      session: { type: "string" },
      output: { type: "string" },
      "logs-file": { type: "string" },
    },
  });

  if (!values.number || !values.agent || !values["run-url"]) {
    console.error("usage: post_result_comment.ts --number N --agent NAME --run-url URL [...]");
    process.exit(2);
  }

  // Redacted on the way out, by shape only.
  //
  // GitHub Actions masks registered secrets in the workflow LOG and does nothing
  // for an issue comment, and this comment is the agent's own text -- whatever it
  // saw and chose to repeat. `redact()` with no literals applies the credential
  // shape patterns, which needs no knowledge of any particular value and so works
  // in this step, which deliberately holds none.
  //
  // A net, not a control: see shared/redaction.ts on what a shape check cannot
  // catch. The reason it is here at all is that this is one of the two sinks that
  // publish unmasked text (the other is the failure excerpt in
  // atomaton-runner.wac.ts).
  // Required, not defaulted. A default would put the old relative path back and
  // restore the exact silence this is fixing: a caller that forgot the argument
  // would look in the work tree, find nothing, and report a session that ended via
  // a tool call.
  const outputFile = values.output;
  if (!outputFile) {
    console.error("post_result_comment.ts: --output is required (the agent's stdout file)");
    process.exit(2);
  }
  const redacted = redact(existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "");

  // `atomaton_output.txt` is empty whenever the run ended via a session-ending
  // tool call (launch_sub_agent, request_close_issue, create_pr -- see
  // src/content/tools/scripts/mcp/{atoma,github}.ts's `_meta.session_ends`):
  // atoma's own inference loop stops immediately in that case, before the
  // model ever gets a further turn to produce text. Each of those tools
  // already posts its OWN dedicated, meaningful comment (e.g. "Launched
  // sub-agent(s): ...", "PR #N created..."), so posting a second, essentially
  // content-free "run by [agent](url)" comment here on top of that would
  // just be noise -- skip entirely rather than post an empty wrapper.
  // Empty output has two meanings, and they need opposite treatment.
  //
  // A session-ending tool call leaves it empty because atoma's loop stops the moment
  // that tool returns, before the model gets another turn -- and each of those tools
  // posts its own comment, so a second content-free one would be noise. That is the
  // skip below, and it is right.
  //
  // Reaching a limit leaves it empty too, and there nothing else speaks.
  // Measured: a run spent 17 minutes and 154k tokens, and the thread received
  // one notice saying the limit was reached. What it had worked out was in the
  // session and nowhere a person would look.
  // A run that was cut short did not choose to end, so the two empties are told
  // apart by how the run ended rather than by what it left behind.
  const endedEarly = cutShort(values["ended-because"]);

  let output = redacted;
  let salvaged = false;
  let wroteNothing = false;
  if (!output.trim() && endedEarly) {
    const last = lastAgentText(values.session, Number(values["messages-before"]));
    if (last !== undefined) {
      output = redact(last);
      salvaged = true;
      console.error("salvaged the agent's last message from the session (cut short)");
    }
  }

  if (!output.trim()) {
    // The skip is right for a session-ending tool call: that tool posted its own
    // comment and a second content-free one is noise.
    if (!endedEarly) {
      console.error("atomaton_output.txt is empty (session ended via a tool call) -- skipping result comment.");
      return;
    }
    // It is wrong for a run that was cut short, and this is the common shape rather
    // than the odd one. A stop lands at the next turn boundary, so a run reading
    // files when it arrives has said nothing at all and there is nothing to salvage
    // -- measured on #831, which spent nine iterations in tool calls and produced no
    // assistant text. Skipping there drops the machinery's own sentence along with
    // the agent's silence: that it stopped, that the session survived, and how to
    // resume. None of those are the agent's to say, and the footer below says them.
    wroteNothing = true;
    output = values["ended-because"] === "stopped"
      ? "_This run was stopped before it said anything._"
      : `_This run ${howItWasCutShort(values["ended-because"])} before it said anything._`;
    console.error("the run was cut short with nothing to report -- posting the notice rather than nothing.");
  }

  // Checked on the way out for the same reason it is redacted on the way out:
  // this text is whatever the agent decided to write, and a comment is the one
  // place it reaches people. A `@name` here notifies a real account -- see
  // `domain/work/mention.ts` for why a name it read somewhere is enough.
  //
  // The mention the RUNNER adds is not part of this. It is put in by
  // `buildCommentBody` below from a login `resolveNotify` produced, and never
  // passes through here.
  const checked = escapeUnknownMentions(
    output,
    knownParticipants(process.env.GITHUB_REPOSITORY ?? "", values.number),
  );
  if (checked.escaped.length > 0) {
    console.error(`escaped ${checked.escaped.length} unconfirmed mention(s): ${checked.escaped.join(", ")}`);
  }

  const body = buildCommentBody({
    agent: values.agent,
    salvaged,
    wroteNothing,
    notify: values.notify,
    directive: values.directive,
    chainContinues: values["chain-continues"],
    endedBecause: values["ended-because"],
    reported: values.reported === "true",
    runUrl: values["run-url"],
    // From the environment rather than a flag: every caller is a workflow step, and
    // one more argument to thread through is one more place to forget it.
    repo: process.env.GITHUB_REPOSITORY ?? "",
    output: checked.text,
    escapedMentions: checked.escaped,
    changed: values.changed === "true",
    // The same boundary the salvage uses, for the same reason: a session accumulates
    // across runs, and a count taken from the top would put an earlier run's trouble
    // under this one's comment.
    toolTrouble: toolTroubleLine(readSession(values.session), Number(values["messages-before"])),
    usageLines: tokenUsageLines(values["logs-file"] ?? ""),
    ...subIssueState(values.number, values.type),
  });

  const { code, stdout, stderr } = gh(
    "api",
    `repos/${process.env.GITHUB_REPOSITORY}/issues/${values.number}/comments`,
    "--method",
    "POST",
    "-f",
    `body=${body}`,
    "--jq",
    ".id",
  );
  if (code !== 0) {
    throw new Error(`Failed to post result comment: ${stderr || stdout}`);
  }

  const commentId = stdout.trim();
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, `comment_id=${commentId}\n`);
  console.error(`Posted comment ID: ${commentId}`);
}

if (import.meta.main) main();
