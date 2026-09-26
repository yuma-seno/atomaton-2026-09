# What `config.yaml` accepts

`.github/atomaton/config.yaml` is where a project declares everything about
itself, and this is that file's surface: every key it accepts, and where the
entry for each one is.

The file itself carries a line or two per key — enough to know what you are
looking at while editing. Anything longer is in the entry, so that the config
stays scannable and a reason is written once rather than in two places that can
drift.

The entry is somewhere else because the tree is arranged by what a key is about
rather than by the file it is serialised in: `merge.gates` is answered beside
everything else about a pull request, and `environment.max_reloads` beside
everything else about the runner. This table is the one place that knows both.

| Key | Its entry |
| --- | --- |
| `agents.on_config_finding` | [work](../work/reference.md#agentson_config_finding) |
| `base_branch` | [work](../work/reference.md#base_branch) |
| `chain.after_handoffs` | [work](../work/reference.md#chainafter_handoffs) |
| `chain.after_runs_without_change` | [work](../work/reference.md#chainafter_runs_without_change) |
| `chain.labels.in_progress` | [work](../work/reference.md#chainlabels) |
| `chain.labels.launched` | [work](../work/reference.md#chainlabels) |
| `chain.labels.sub_issue` | [work](../work/reference.md#chainlabels) |
| `checks.from_default_branch` | [pipeline](../pipeline/reference.md#checksfrom_default_branch) |
| `checks.from_pull_request` | [pipeline](../pipeline/reference.md#checksfrom_pull_request) |
| `checks.your_workflow` | [pipeline](../pipeline/reference.md#checksyour_workflow) |
| `deploy.on_demand` | [pipeline](../pipeline/reference.md#deployon_demand) |
| `deploy.on_merge` | [pipeline](../pipeline/reference.md#deployon_merge) |
| `deploy.on_tag` | [pipeline](../pipeline/reference.md#deployon_tag) |
| `deploy.your_workflow` | [pipeline](../pipeline/reference.md#deployyour_workflow) |
| `environment.max_reloads` | [environment](../environment/reference.md#environmentmax_reloads) |
| `environment.setup_commands` | [environment](../environment/reference.md#environmentsetup_commands) |
| `merge.gates` | [pull requests](../pull-requests/reference.md#mergegates) |
| `merge.governed_paths` | [pull requests](../pull-requests/reference.md#mergegoverned_paths) |
| `merge.policy` | [pull requests](../pull-requests/reference.md#mergepolicy) |
| `tools.packages.bun` | [tools](../tools/reference.md#toolspackages) |
| `tools.packages.npm` | [tools](../tools/reference.md#toolspackages) |
| `tools.packages.pip` | [tools](../tools/reference.md#toolspackages) |
| `tools.secrets` | [tools](../tools/reference.md#toolssecrets) |
| `tools.servers` | [tools](../tools/reference.md#toolsservers) |
| `tools.watch` | [tools](../tools/reference.md#toolswatch) |
| `runs_on`, on any `checks` or `deploy` entry | [pipeline](../pipeline/reference.md#runs_on) |

A key that is not on this list is one nothing reads — see
[when your config is wrong](when-it-breaks.md).

A setting that describes one agent rather than the delivery system is not here at
all. It belongs in that agent's definition, which is
[Atoma's own contract](../agents/overview.md) rather than this project's.
