/**
 * agent-on-issue.ts — which agent last worked on a node, read from its thread.
 *
 * ## Why this exists
 *
 * "Who was working here" is asked in three places that have nothing else in common:
 * `/resume` fills in the name a person left out, the aggregation gate re-invokes
 * whoever was on the parent, and a subtree resume walks every node asking the same
 * thing. Each answered it its own way, and one of them answered it with a literal
 * `"atomaton"` -- so a project that renamed its atomaton got an aggregation
 * that dispatched an agent with no definition, from a workflow nobody was watching.
 *
 * ## Where the answer is
 *
 * The thread, not a store. Every result comment carries `atomaton:agent` --
 * `post_result_comment.ts` writes it so a later run can recognise its own past
 * output -- so the most recent one is the answer, and there is nothing extra to
 * keep in sync. A store would be a second answer to a question the thread already
 * answers, and the half that falls behind is the half nobody reads.
 *
 * ## Why newest first
 *
 * An issue worked by an atomaton and then an engineer must resume the engineer.
 * Taking the first match in chronological order would resume whoever went first,
 * every time, for the whole life of the issue.
 *
 * ## Why it lives here rather than in `domain/`
 *
 * The pure half -- "the last body that names an agent" -- is a fold over strings,
 * but the question the callers ask is about a GitHub node, and answering it needs
 * `gh`. `domain/` may not reach the world, so the reader is here beside the other
 * modules that read a thread, and the tag format stays in `tags.ts` where it is
 * defined.
 */
import { gh } from "./gh.ts";
import { AGENT_TAG } from "./tags.ts";

/**
 * The agent named by the most recent comment that names one, or `""`.
 *
 * Empty is a real answer and not an error: a node nothing has run on has no agent
 * to resume, and every caller says so in its own way rather than dispatching an
 * agent called "".
 */
export function mostRecentAgent(bodies: readonly string[]): string {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const agent = AGENT_TAG.read(bodies[i] ?? "");
    if (agent) return agent;
  }
  return "";
}

/**
 * The same question, asked about a node.
 *
 * A failed read returns `""` rather than throwing, which is the same answer as a
 * node nothing ran on. The callers treat both as "nobody to start", and the
 * alternative -- failing a dispatch over a mention-like lookup -- would turn a
 * transient API error into work that never resumes.
 */
export function mostRecentAgentOn(repo: string, number: number): string {
  const { code, stdout } = gh(
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[].body]",
  );
  if (code !== 0) return "";
  try {
    return mostRecentAgent(JSON.parse(stdout || "[]") as string[]);
  } catch {
    return "";
  }
}
