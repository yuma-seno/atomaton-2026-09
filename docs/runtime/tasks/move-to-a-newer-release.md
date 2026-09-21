# Move to a newer release

There is no upgrade command, and a copy is not one. The deliverable contains files that
are generated and files that are yours to tune, and only you can say which of your edits
are deliberate. So treat it as vendoring, and let git do the merge:

```bash
gh release download v0.1.115 -R yuma-seno/atomaton -p atomaton-delivery.zip
unzip -o atomaton-delivery.zip   # the archive holds .github/, so run this at the repo root
rm atomaton-delivery.zip
git diff .github/            # every difference is now a decision
git checkout -- .github/atomaton/config.yaml    # for anything you meant to keep
```

Name the version rather than taking `latest`, and read the upstream changes between
yours and the next one (`gh release view`, or compare the two tags) rather than
rediscovering them in a diff.

**Which release do I have?** `.github/atomaton-release.json` says. It ships with the
release and records the version and every path the release contains:

```bash
jq -r .version .github/atomaton-release.json
```

**What did upstream delete?** Extracting never deletes, so a file the template dropped
stays in your tree — and that is not cosmetic. Two workflows were removed in v0.1.71
because work should start only when somebody asks; keeping them keeps the triggers. The
manifest is what makes them findable:

```bash
# Paths you have under .github/ that this release no longer ships.
# Your own files appear here too, which is why it is a list to read, not to pipe
# into rm.
comm -23 \
  <(git ls-files '.github/*' | sort) \
  <(jq -r '.files[]' .github/atomaton-release.json | sort)
```

Read it rather than acting on it: your own workflows and your own project skills are
files the template never shipped, and they are supposed to be there.

Which files are replaced wholesale, which are yours outright, and which are both is the
ownership table in [docs/configuration.md](../../configuration.md). The safest habit is to keep
your customisation where the template will not fight you for it — `config.yaml` covers
the labels, the merge policy, the environment setup, the tool servers and the workflows
to dispatch, and `skills/project/` is yours outright.
