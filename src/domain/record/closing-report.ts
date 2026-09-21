/**
 * closing-report.ts — did the run say anything, asked of its own session.
 *
 * A run either ends having written a report or it does not, and the session says
 * which: the last assistant message carries words, or it carries only tool calls.
 * Nothing has to be recorded for this and nothing is asked of the agent — which is
 * the point, because what an agent says about itself is the one thing this project
 * has measured to be unreliable.
 *
 * ## Why one definition with two readers
 *
 * Both readers were about to spell the same question their own way, and the first
 * one nearly did.
 *
 *   - `read_run_ending.ts` asks it of the run that just finished, so
 *     `domain/work/turn.ts` can answer `no-report` instead of `finished` — the
 *     ending a run gets when it stops of its own accord having said nothing.
 *   - `write_metrics_report.ts` asks it of every stored session, so the report a
 *     person reads to ask how the agents are doing stops calling those runs a
 *     success.
 *
 * The second is why this file exists rather than the function staying where it was
 * written. The comment on such a run now tells a person; the metrics report, which
 * reads the core's `ended_because` and knows nothing of the domain's endings, still
 * said `completed`. The lie had moved, not gone. Two spellings of "did it report"
 * would have been the defect; one definition read from two places is one fact in one
 * place. `tool-trouble.ts` is here for the same reason and was moved for it.
 *
 * ## What it does not need
 *
 * No migration, and none should be invented. This is derived from the messages a
 * session already holds, so it answers for every session ever stored — including the
 * hundreds recorded before anybody thought to ask.
 */
import type { Session, SessionMessage } from "../work/session.ts";

/**
 * The words in a message, whichever of the two shapes it is stored in.
 *
 * A message is plain text in nearly every case; the block form appears when a
 * picture travels with it. A picture is not a report, so only the text blocks count.
 */
function textOf(content: SessionMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/**
 * Whether the run left a report: did the last thing the model said have words in it?
 *
 * The LAST assistant message, not any of them. An earlier one is a sentence from the
 * middle of the work, and this repository has already measured what that is worth —
 * these agents write prose exactly once, in their final turn (450 assistant turns
 * with 1 carrying text; 204 with 1; 200 with 0). Treating one as a report would call
 * a run reported that a person would call silent, and `post_result_comment.ts`
 * already labels such a sentence as "not a conclusion" when it shows one.
 *
 * ## It answers for the session, which is the last run in it
 *
 * A session accumulates across runs and this takes no run boundary, so what it
 * answers is "did the LAST run to touch this session say anything". That is the
 * question in both places.
 *
 * For `read_run_ending.ts` the last run is the one that just finished, unless that
 * run produced no assistant message at all — which means it was cut short before its
 * first turn, and `failed`, `stopped` and `spent` are all decided above `no-report`
 * in `endingOf`, so the answer given here is not the one read. A boundary would be a
 * second argument that changes no decision.
 *
 * For the metrics report it is what can be known at all: an earlier run's silence is
 * buried under everything said since, and no amount of walking backwards recovers
 * which message belonged to which run.
 *
 * `false` for a session that is missing or holds no assistant message. A run that did
 * not write the session it was told to write is not one to record as having reported.
 */
export function leftClosingReport(session: Session | undefined): boolean {
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return textOf(message.content).trim() !== "";
  }
  return false;
}
