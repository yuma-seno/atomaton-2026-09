# The tools file, and why you do not have one

`atoma` is handed a tools file, which is its own format. That file is **written
at the start of each run** — from the servers Atomaton ships plus whatever
`tools.servers` in `config.yaml` adds or overrides — into the runner's temp
directory, and thrown away with the runner. There is none in your repository and
you are not meant to have one.

So there is no second list to keep in step, and no file to edit instead of
`config.yaml`. The shipped entries the file starts from are readable, in
`.github/atomaton-runtime/tools/defaults.yaml`, and the servers those entries run
are beside them under `.github/atomaton-runtime/tools/mcp/`.

It used to ship, generated once when the deliverable was built, and an adopter
then held a config and a file generated from it with nothing on their side able to
regenerate one from the other. `.github/atomaton/README.md` has what that cost and
what to delete if your tree still carries one. The reason it is written per run
rather than fixed is the general one: **a generated file that is distributed is a
second source of truth wearing the clothes of a first.**

The check on every pull request writes one the same way, from that pull request's
own config, so what it resolves names against is what the pull request would
actually run with —
[what a pull request is checked against](../../operations.md#what-a-pull-request-is-checked-against).
