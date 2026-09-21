# The pipeline as commands

You can point Atomaton at workflows you wrote. Or you can write no workflow at
all and describe the pipeline as commands:

```yaml
checks:
  from_pull_request:
    - name: verify
      commands:
        - bun install --frozen-lockfile
        - bun run typecheck
        - bun test

deploy:
  on_merge:
    - name: staging
      branches: [develop]
      commands: ["./scripts/deploy.sh staging"]
  on_tag:
    - name: production
      tags: ["v*"]
      branches: [main]
      secrets: [PROD_TOKEN]
      commands: ["./scripts/deploy.sh prod"]
  on_demand:
    - name: rollback
      commands: ["./scripts/rollback.sh"]
```

Nothing needs pointing at these. `atomaton-check.yml` and `atomaton-deploy.yml`
are what a section runs when it names no `your_workflow`; fill in the commands
and they run. There is no `on:` key to get wrong and no combination to remember —
**the three deploy lists are the trigger.**

An agent can write this file, which is the reason the shape exists at all.
GitHub refuses `GITHUB_TOKEN` a write under `.github/workflows/**` by identity, on
every path and every branch, and no permission grants it — so a pipeline expressed
as YAML there is a pipeline an agent can read and never maintain. Expressed
as commands in `config.yaml`, it is a pipeline an agent can extend, and one a
person still reviews before it merges, because
[that file is governed](../pull-requests/reference.md#mergegoverned_paths).

**One check ships filled in**, a secret scan, and it is the only default. A
credential is a credential in every language, so it is the one verification a
template can hand a project it knows nothing about; everything else belongs to
the project. What it does is in
[its entry](reference.md#checksfrom_pull_request).

Where each key goes is in [the reference](reference.md). What a pipeline
described this way cannot express — and where you still need a workflow of your
own — is in [what a deployment refuses to do](boundaries.md).
