import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WORKSPACE_PATH } from "../../src/domain/work/workspace.ts";

describe("agent prompt contracts", () => {
  test("uses orchestrator-first delegation with an explicit engineer leaf gate", () => {
    const orchestrator = readFileSync("src/content/agent-definitions/orchestrator.md", "utf8");
    expect(orchestrator).toContain("assign them to `orchestrator` by default");
    expect(orchestrator).toContain("only when it satisfies every leaf condition");
    expect(orchestrator).toContain("File count and apparent effort do not determine leaf status");
  });

  /**
   * The outcome that did not exist, and the run that measured its absence.
   *
   * The engineer's `Outcome` table was five rows, all of them "implement and open a
   * pull request" or "refuse". Asked for an inventory, it spent 200 iterations and
   * 324 shell calls and posted nothing -- because there was no outcome to arrive at.
   * The shared template says a run asked to investigate is not blocked on anything;
   * the engineer's own contract overrode that with a seven-step pipeline to a PR.
   *
   * Pinned because the failure is invisible: a run that never arrives looks like a
   * run that is still working, right up to the iteration limit.
   *
   * ## Why this now reads the template rather than `engineer.md`
   *
   * Because the same failure was then measured on an agent that never had the row.
   * An orchestrator asked to explain something built a sub-issue and dispatched an
   * engineer at it, and ten orchestrator sessions ended by answering a question its
   * outcome table had no line for. The exit is not the engineer's; it belongs to
   * any run that can be asked a question, which is all three. So it is stated once,
   * in the shared template, beside the two other exits every role shares -- and
   * what this guards is that it exists somewhere an agent reads, not which file
   * that is.
   */
  test("an agent asked a question has somewhere to arrive", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    expect(prompt, "the shared exits must offer answering as an outcome").toContain(
      "What was asked is a question",
    );
    // And a rule for when to stop looking, which is the other half: an outcome you
    // can reach is no use if nothing says when you have enough to reach it.
    expect(prompt).toContain("An investigation ends when you can answer what was asked");
    expect(prompt).toContain("write what you have and name what you could not establish");
    // The role contracts must not answer it a second time in their own words. Three
    // vocabularies for one exit is what put the reviewer's outcomes under a heading
    // the other two do not have, and left the orchestrator's table a row short.
    for (const role of ["engineer", "orchestrator", "reviewer"]) {
      const text = readFileSync(`src/content/agent-definitions/${role}.md`, "utf8");
      expect(text, `${role}.md must point at the shared exits rather than restating them`).toContain(
        "The three outcomes every role shares are in `Ending a run` above",
      );
    }
  });

  test("prevents engineers from implementing unresolved non-leaf work", () => {
    const engineer = readFileSync("src/content/agent-definitions/engineer.md", "utf8");
    expect(engineer).toContain("If it is not engineer-ready, do not edit");
    expect(engineer).toContain("Return `/orchestrator` on the first line");
  });

  /**
   * The three properties of the skill wording, rather than the sentence carrying them.
   * This test used to pin "Load each relevant skill with ..." word for word, which said
   * nothing about why that sentence had to be there and broke on the rewrite that fixed
   * it.
   *
   * Each is a measured failure. A run that needed `research/web-search` read the skill
   * file with `sed` instead of loading it, then spent 240 shell searches inside a
   * repository that did not hold the answer -- so the prompt has to name the tool, say a
   * skill replaces your own approach rather than informing it, and say to look at the
   * catalog again when the work changes shape. That run loaded skills twice, both times
   * in its first minute.
   *
   * ## What it no longer pins
   *
   * `reviewer.md` used to be read here for `Load \`review/quick-quality-gate\``, as the
   * one instruction to load a skill that was not optional. It is not an instruction any
   * more: the mandatory checks are in `reviewer.md` itself. Two lines of the same file
   * asked for the same step by two mechanisms and were obeyed 224/227 and 43/227 -- the
   * difference being the mechanism rather than the wording -- so the required half moved
   * to where the obeyed half already was. What replaced this assertion is the test below
   * that reads those checks in the definition.
   */
  test("loads procedures as skills without requesting visible chain of thought", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    expect(prompt).toContain("atoma_builtin__load_skill");
    expect(prompt).toContain("in place of your own approach");
    expect(prompt).toContain("Check the catalog again");
    expect(prompt).toContain("Reason privately");
    expect(prompt).not.toContain("Before taking action or generating final output, always use the `<thought>` tag");
  });

  /**
   * The directive line is described, and never spelled.
   *
   * This pinned the opposite: that the template said "the directive line must contain
   * only `/agent-name`". The sentence is correct and the string in it is not a name --
   * `extract_directive.ts` resolves a directive against the agent definitions on disk,
   * so `/agent-name` dispatches nobody.
   *
   * Ten runs posted it literally, nine of them on the first line of their final message,
   * and nine of those were holding the warning that follows it -- "never the placeholder
   * itself" -- while they did. Six had a failing required check and a contract row
   * saying to hand the work to the engineer; no engineer was started, and every one of
   * those runs was recorded as finished.
   *
   * A warning cannot beat the prompt supplying the string, so the string is gone. The
   * shape is described in words and the real names arrive immediately after it, from
   * `{{COLLEAGUES_LIST}}`, which the template now places at the point of use rather than
   * in a context block far above it. What this guards is that neither half comes back:
   * no literal placeholder anywhere in the template, and the colleague list still
   * rendered where the directive is explained.
   */
  test("the template describes the directive line without supplying a placeholder to copy", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    const orchestrator = readFileSync("src/content/agent-definitions/orchestrator.md", "utf8");
    expect(prompt, "a placeholder in the prompt is a string a run can post verbatim").not.toContain(
      "/agent-name",
    );
    expect(prompt).toContain("a line that holds nothing but a slash and");
    // The names themselves, beside the sentence that asks for one.
    const directive = prompt.indexOf("a line that holds nothing but a slash and");
    const colleagues = prompt.indexOf("{{COLLEAGUES_LIST}}");
    expect(colleagues, "the colleague list must be rendered").toBeGreaterThan(-1);
    expect(colleagues, "the names belong at the point of use, not in a block above").toBeGreaterThan(directive);
    expect(orchestrator).toContain("Return `/engineer` on its own line");
  });

  /**
   * The report is a contract with four parts, and one of them is where the run's only
   * copy of something lives.
   *
   * What the prompt used to say about reporting was a subordinate clause inside a
   * paragraph about how comments are delivered -- "That is how you report: findings,
   * measurements, what you could not do, what a person should look at" -- under a
   * heading that said "Ending a Run". Measured over 362 reports: 9 said anything about
   * what they could not confirm, 27 of the 30 runs whose own tools reported a fault
   * discarded it with the run, and 111 of 246 reviews discussed nothing but merge state
   * GitHub was already displaying beside them.
   *
   * So the parts are named and ordered, and the part that goes missing is the one with
   * an explicit floor: write that there is nothing rather than leaving it out. What is
   * pinned is the four headings and that floor -- not the prose around them.
   */
  test("the report contract names its parts and refuses an empty one", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    for (const part of [
      "What you concluded",
      "How you know",
      "What you could not establish",
      "What happens next",
    ]) {
      expect(prompt, `the report contract must name "${part}"`).toContain(part);
    }
    expect(prompt, "the part that goes missing needs a floor, not an encouragement").toContain(
      "leaving the part out is itself a claim",
    );
  });

  /**
   * And it has to say where the report goes when there is no turn left to write it in.
   *
   * A session-ending tool call stops the inference loop the moment it returns, so a run
   * that meant to report afterwards never does. Measured: 27 of 108 engineer runs left
   * no report at all, and the shape they share is the successful one -- the run opened
   * its pull request and stopped. The report is not missing from those runs, it is in a
   * tool argument, and nothing said so.
   *
   * Every one of those calls carries a text argument now, `launch_sub_agent` included.
   * That one had none until this change: three of the four session-ending calls carried
   * the report and the fourth did not, which is an exception rather than a gap in the
   * contract. Pinned by argument name, because the name is the part a run has to get
   * right.
   */
  test("the report has a named place in every call that ends the session", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    expect(prompt).toContain("the report goes in that");
    expect(prompt, "and before the call, because there is no after").toContain(
      "before you make the call",
    );
    for (const argument of ["`body`", "`summary`", "`reason`"]) {
      expect(prompt, `the report's place must be named: ${argument}`).toContain(argument);
    }
  });

  // Pins the two rules the agents were observed breaking, because each failure
  // looked like success: the reviewer answered `LGTM` in prose and merged nothing,
  // and it announced that it would wait for a check with nothing able to resume
  // the run. Both are properties of the wording, so they belong in a test.
  test("tells every agent that an outcome is a tool call and that it cannot wait", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    // Single-line substrings on purpose: these files are wrapped prose, and a
    // phrase spanning a line break also picks up whatever indentation wraps it.
    expect(prompt).toContain("outcome means making that call");
    expect(prompt).toContain("You cannot wait");
  });

  /**
   * The reviewer reaches its verdict before it asks who may merge.
   *
   * This pinned the reverse -- "Do this before deciding" -- which put
   * `check_merge_readiness` at step 1 of the review. What that produced is a review
   * that never happens: 107 of the runs that called it made no other operational call
   * at all, and 95 of those were pull requests a person had opened, where the answer to
   * "who merges this" was settled before the reviewer was ever dispatched. Of 246
   * reviews, 111 discussed nothing but merge machinery that GitHub was displaying beside
   * them, and 169 named no file.
   *
   * The call is not wrong and has not moved out of the contract; its position has. It
   * answers who may merge and under what conditions, never whether the change is sound,
   * and a contract that asks it first turns a review into merge administration. So what
   * is pinned now is the order: the verdict comes from what was read, and the readiness
   * call comes after it.
   */
  test("the reviewer decides from what it read, then asks who may merge", () => {
    const reviewer = readFileSync("src/content/agent-definitions/reviewer.md", "utf8");
    expect(reviewer).toContain("Decide from what you read");
    expect(reviewer, "the readiness call must not come first again").toContain(
      "once you have a verdict, not before",
    );
    expect(reviewer).not.toContain("Do this before deciding");
    // The outcome is the call, not the sentence that describes it. Was two calls
    // until `submit_pr_review` was removed -- a review the shared identity can
    // neither approve nor request changes with said what the final message says.
    expect(reviewer).toContain("without making the merge call merges");
    // `checks-missing` used to say "call check_merge_readiness again", which no
    // agent can do usefully -- the check it is waiting on outlives the run.
    expect(reviewer).toContain("you cannot wait for it");
  });

  /**
   * The mandatory checks are in the definition, not behind a load.
   *
   * They were the body of `review/quick-quality-gate`, and the reviewer was told to load
   * it as step 1. Two lines of that same file asked for a step apiece: the tool call was
   * made in 224 of 227 reviews and the skill was loaded in 43, with 154 never attempting
   * it. Same agent, same file, adjacent lines -- so what differs is the mechanism, and a
   * check that is not optional does not belong behind an optional one.
   *
   * Each check exists because its evidence is, by definition, in a file the diff does not
   * contain: the callers of a deleted name, the definitions that still name a renamed
   * server, the source a generated file came from. A review that only reads the diff
   * cannot reach any of them, which is why the budget they were weighed against is gone
   * too.
   */
  test("the reviewer's mandatory checks are in its own definition", () => {
    const reviewer = readFileSync("src/content/agent-definitions/reviewer.md", "utf8");
    expect(reviewer).toContain("## Mandatory checks");
    expect(reviewer, "a removal is the check the diff cannot answer").toContain("Anything removed");
    expect(reviewer).toContain("agent-definitions/");
    expect(reviewer, "generated output is a defect even when its content is right").toContain(
      "Generated output touched",
    );
    // No budget to weigh them against. "Four operational tool calls is the target" was
    // the one number in the prompt layer with no measurement behind it, and it was met
    // by not reading anything.
    expect(reviewer).not.toContain("operational tool calls is the target");
  });

  /**
   * The sentence this turns on, in both places an agent reads it.
   *
   * A tool server can now say it answered worse than it should have, and
   * the same warning produces two very different runs depending on what the agent
   * concludes: "my query was poor" ends in trying again differently, and "the
   * reranker is not running" ends in an issue. The second was the truth when it happened and
   * the first is what an agent asked whether something went badly reaches for, because
   * its own conduct is what it has been told to examine.
   *
   * So the attribution is not a nicety of wording -- it is the whole mechanism. Pinned
   * the way the reviewer's two rules above are pinned: the failure looks like success,
   * because a run that files an apology instead of a defect still reads as a run that
   * noticed something.
   */
  test("says a problem a tool reported about itself is not the agent's failure", () => {
    // One file now, where it was two. It was in the template AND in
    // `engineering/environment`, and the skill was the half carrying the procedure --
    // so the template asked the agent to load a skill to find out what to do about a
    // block that had already arrived in a tool result. Of 30 runs that met one, 4
    // loaded it. The trigger is a result every agent can receive and the response is
    // three steps long, so both are in the template, beside the tool descriptions the
    // block is attached to, and the skill keeps only the dependency questions its
    // description names.
    const file = "src/content/prompt-template.md";
    const text = readFileSync(file, "utf8");
    expect(text, `${file} must not let a tool's degradation read as the agent's fault`).toContain(
      "not a failure of your work",
    );
    // And the procedure has to travel with it, or the attribution is advice with
    // nowhere to go.
    expect(text, "the run that saw it is the only one that can file it").toContain("sub_issue: false");
  });

  /**
   * The first thing a re-invoked agent reads, and the paragraph it has to agree with.
   *
   * After a merge, `dispatchPostMergeAgent` posts a comment on the issue and then starts
   * an agent on it. That comment is a user message, ahead of the system prompt in the
   * only ordering a model has -- and it said "Please confirm completion and close this
   * sub-task", which is an answer, not a question. An agent told to confirm has no
   * remaining reason to read the issue.
   *
   * What the re-invocation is for is the opposite: deciding whether what merged
   * satisfies what the issue asked for, and carrying on when it does not. A merge is
   * evidence that a change was accepted, not that a requirement was satisfied.
   *
   * Pinned as a pair because either half alone is worse than neither. The prompt asking
   * for a judgement while the trigger asks for a closure is a contradiction the trigger
   * wins; the trigger asking for a judgement with no contract behind it is a run with no
   * outcome to reach.
   */
  test("the post-merge trigger and the prompt ask for the same thing", () => {
    const trigger = readFileSync("src/adapters/actions/dispatch-targets.ts", "utf8");
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    expect(trigger, "the trigger comment must not prejudge the answer").not.toContain(
      "Your PR was merged",
    );
    expect(trigger).toContain("Decide whether what merged satisfies what");
    expect(prompt).toContain("After a pull request you opened has merged");
    expect(prompt, "the contract has to say a merge is not the question").toContain(
      "a merge is evidence that a change was accepted, not that a requirement was satisfied",
    );
  });

  /**
   * And the template has to close the loop, not just absolve the agent.
   * `docs/method/edd.md` names the failure this is against: "Whoever observed the gap
   * cannot propose the fix, so it waits until someone else notices." The run that saw
   * the warning is the only one holding it, so filing is part of seeing it.
   *
   * `sub_issue: false` because the default is true: a defect in the tools would
   * otherwise be filed as a child of whatever the agent happened to be working on,
   * and disappear when that issue closed.
   *
   * This read `engineering/environment`, which held the procedure until the template
   * absorbed it -- see the test above for why. It reads the template now, and what it
   * guards is unchanged: the filing call, and the argument that keeps the issue from
   * being buried under the work that found it.
   */
  test("a reported problem turns into a filed issue that outlives the work", () => {
    const prompt = readFileSync("src/content/prompt-template.md", "utf8");
    expect(prompt).toContain("github__create_issue");
    expect(prompt, "a tool defect is not a child of the current issue").toContain("sub_issue: false");
    expect(prompt, "and the run has to say so where the next reader looks").toContain(
      "Say so in your report",
    );
  });

  /**
   * The scratch workspace's path is stated in three places and has to be one path.
   *
   * `domain/work/workspace.ts` holds it, the runner mounts it there, the prompt template
   * tells the agent about it, and `shell_execute`'s description repeats it. Both of
   * the last two, because a tool's own description was measured to carry more weight
   * than the same words in the system prompt -- and this sentence has to hold
   * at the moment the agent is deciding where to put a file, which is when it is
   * reading the tool.
   *
   * A path that drifted in one of them would be an agent writing somewhere real,
   * being told it persists, and finding it gone -- the exact shape of failure the
   * workspace exists to remove.
   */
  test("the scratch workspace is named identically wherever an agent reads about it", () => {
    for (const file of ["src/content/prompt-template.md", "src/entrypoints/tools/mcp/shell.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} must name the workspace`).toContain(WORKSPACE_PATH);
      // Both halves. "This survives" alone invites leaving working files in the
      // repository as well; "nothing else survives" alone does not say where to
      // put them.
      expect(text.toLowerCase(), `${file} must say it survives`).toMatch(/survive/);
      expect(text, `${file} must say what happens to files left in the repository`).toMatch(/committed/);
    }
  });

  /**
   * And nothing may tell an agent to expand a variable to find it. `ls
   * $SOMETHING_WORKSPACE` with the variable unset returns nothing, which reads
   * exactly like an empty directory -- so the failure and the ordinary case become
   * indistinguishable in the one place a model is looking. The path is written out.
   *
   * This watched for one spelling, `ATOMA_WORKSPACE`, which is the name the
   * variable would have had. Renaming the project left it watching for a string
   * nobody would write, which is a guard that cannot fail rather than a guard that
   * passes. The mistake has a shape -- a variable expansion with WORKSPACE in its
   * name -- and the shape is what is checked now, whatever the project is called.
   */
  test("the workspace is never named through a variable", () => {
    for (const file of ["src/content/prompt-template.md", "src/entrypoints/tools/mcp/shell.ts"]) {
      const expansions = readFileSync(file, "utf8").match(
        /\$\{?[A-Za-z_]*WORKSPACE[A-Za-z_]*\}?/g,
      );
      expect(
        expansions ?? [],
        `${file} names the workspace through a variable. Unset, it expands to nothing and ` +
          `reads as an empty directory; write the path out`,
      ).toEqual([]);
    }
  });
});
