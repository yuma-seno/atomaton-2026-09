# Give a repository a pipeline an agent can write and maintain

Write no workflow. Describe the pipeline as commands in `config.yaml`:

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
```

Nothing needs pointing at these. `atomaton-check.yml` and `atomaton-deploy.yml` are what a
section runs when it names no workflow of your own; fill in the commands and they run.

This is the default arm because **an agent can write configuration and cannot write a
workflow.** GitHub refuses `GITHUB_TOKEN` on `.github/workflows/**` by identity, on
every path and every branch, and no permission grants it. So a repository whose pipeline
lives in `config.yaml` is one an agent can set up, extend and repair; one whose pipeline
lives in workflow YAML always needs a person.

The three deploy lists, where credentials go, and the four things commands cannot
express are in [docs/configuration.md](../../configuration.md).
