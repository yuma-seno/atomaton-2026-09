# Setup

Everything you do to get from an empty repository to a first agent run, in the
order to do it. Getting the deliverable into the tree is the step before these,
in [the README](../README.md).

1. **Enable GitHub Actions in the target repository.** Nothing dispatches an
   agent until it is on.

2. **Allow Actions to create pull requests.** Open **Settings > Actions >
   General > Workflow permissions** and enable **Allow GitHub Actions to create
   and approve pull requests**. Without it the engineer agent cannot open one,
   and [the `permissions` the generated workflows declare are not evidence this
   is done](github/boundaries.md#a-workflow-cannot-grant-itself-what-the-repository-withholds).

3. **Add the repository secret `ORCAROUTER_API_KEY`.** **Settings > Secrets and
   variables > Actions > New repository secret**, under that name. It is the one
   credential the shipped configuration needs: every shipped agent definition
   reads `provider: orcarouter-responses`. [Why that
   provider](agents/overview.md#why-the-shipped-provider-is-a-recommendation),
   and [how to run on another
   one](agents/tasks/move-to-a-different-provider.md).

4. **Put your install and build commands in `environment.setup_commands`,** in
   `.github/atomaton/config.yaml`:

   ```yaml
   environment:
     setup_commands:
       - "bun install --frozen-lockfile"
   ```

   [What else the key does, and why your install belongs here rather than at the
   front of your
   check](environment/reference.md#environmentsetup_commands).

5. **Apply the branch ruleset** — [make a branch ruleset work with
   agents](github/tasks/make-a-branch-ruleset-work-with-agents.md), which is the
   file to import and the two settings that have to be right for agents. This
   step is not conditional on already having rules: it is how you get them.

6. **Record the version you adopted.** `latest` is the convenient path; name a
   version instead when you want to know what you took and diff it later.
   Getting to the next one is vendoring rather than installing — [move to a
   newer release](runtime/tasks/move-to-a-newer-release.md).

7. **Open the first issue.** Its first visible line is a bare agent name, and
   the request goes on the lines below. **Start with `atomaton`** — it is the
   agent a person reaches first, and it decides whether what you described is a
   question to answer, one leaf to do, or work to split into sub-issues. The
   three that ship — `atomaton`, `engineer` and `reviewer` — are a template
   rather than a fixed set: [what an agent definition
   is](agents/overview.md), and how to add one of your own. [How to ask, and what happens
   next](work/how-it-works/what-starts-a-run.md#how-to-ask).
