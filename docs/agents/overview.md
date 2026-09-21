# What an agent definition is

One Markdown file per agent under `.github/atomaton/agent-definitions/`, with the
settings in its frontmatter and the role prompt below it. `<name>` is what
`/<name>` dispatches.

This is Atoma's own contract rather than this project's, which is why a setting
that describes one agent is here and not in `config.yaml`: a definition stays
portable because it describes an agent, not a delivery pipeline.

`.github/atomaton/prompt-template.md` is what every agent is told, whichever one
it is — it is passed to Atoma with `--template` on every runner invocation, and
each role prompt is placed inside it. Skills live under
`.github/atomaton/skills/**/*.md`; `.github/atomaton/README.md` says which of
those directories the template ships and which are yours outright.

## Why the shipped provider is a recommendation

All three shipped agents declare `orcarouter-responses`, and **that default is a
recommendation, not an arbitrary pick. The reason is adoption cost.** One key
reaches every vendor in the catalogue, so changing model later is an edit to one
line rather than another account, another billing relationship and another
secret. It serves both dialects, so `provider` can move between the pair without
the vendor moving with it. And it passes provider list price through unchanged —
including the peak and off-peak tiers some vendors publish — so the hop is not a
markup.

What the hop does cost is one more service that can be down, and one that sees
the traffic. Naming a vendor directly is the trade in the other direction, and
[every row in the table](reference.md#provider) is reachable that way.

## Why `vision` is off by default

The two mistakes cost differently. Sending a picture to a text-only model is an
API error that loses the run; withholding one from a model that could have read
it costs a single tool result, and says why.

All three shipped agents read images now. The engineer did not until its model
could: the flag was off while it ran a text-only model, and a picture that
arrives when nothing sends one costs nothing to allow. Checking whether a model
can, before you set it, is in
[have a screenshot reach an agent as a picture](tasks/have-a-screenshot-reach-an-agent-as-a-picture.md).
