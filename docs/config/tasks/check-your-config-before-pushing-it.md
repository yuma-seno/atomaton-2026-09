# Check your config before pushing it

```bash
bun run .github/atomaton-runtime/scripts/validate_deliverable.ts --root .
```

The same check that runs as the required check on an agent's pull request, against a
checkout or a worktree instead. What it looks at — and what it deliberately leaves to
CI — is in [what a pull request is checked against](../../pull-requests/boundaries.md#what-a-pull-request-is-checked-against).
