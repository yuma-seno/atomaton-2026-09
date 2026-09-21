# What an upgrade replaces, and what is yours

What you receive has **two roots**, and which one a file is under is the whole
rule. `.github/atomaton/` is yours: the config, the agent definitions, the prompt
template, the skills, the rulesets. `.github/atomaton-runtime/` is Atomaton's: the
tool servers, their hooks, the defaults they start from, the packages they need,
and the scripts the workflows run. Nothing in it is a setting, and an edit there
is gone at the next upgrade — which is why it is a directory of its own rather
than a corner of yours. `.github/workflows/` is generated as well; GitHub decides
where that lives. `.github/atomaton/README.md` walks both directories from inside
them, and says why the line falls where it does.

`config.yaml` is **yours**, and an upgrade deliberately restores it. Everything
else under `.github/atomaton/` ships with a default the template also expects you
to tune, which is the awkward part:

| Path | Yours to edit? |
| --- | --- |
| `.github/atomaton-runtime/**`, `.github/workflows/**` | No — generated, replaced wholesale |
| `.github/atomaton/config.yaml` | Yes — every setting lives here on purpose |
| `.github/atomaton/skills/project/**` | Yes — your own skills, the template ships none |
| `.github/atomaton/agent-definitions/**`, `skills/**`, `prompt-template.md`, `rulesets/**` | Both — the template ships defaults it also expects you to tune |

That last row is the one no script can resolve: a difference there is either an
improvement you have not taken yet or a change you made on purpose, and the files
look identical either way. It is why moving to a newer release is
[vendoring rather than installing](tasks/move-to-a-newer-release.md), and why the
safest habit is to keep your customisation in `config.yaml` and under
`skills/project/`, where the template will not fight you for it.

**Paths are not settings.** No key says where any of this lives, and that is a
decision rather than an omission: `.github/atomaton/README.md` gives the three
mechanisms that depend on these two directories being roots.
