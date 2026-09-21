# Every setting in an agent definition

The frontmatter of `.github/atomaton/agent-definitions/<agent>.md`.
[What that file is](overview.md), and why these are not in `config.yaml`, is a
question of its own.

## `model`

The model that agent runs on. Edit the definition and update the frontmatter
`model` field — [run an agent on a different model](tasks/run-an-agent-on-a-different-model.md).

## `vision`

Whether an agent gets pictures from a tool:

```yaml
vision: true
```

Set it when the model reads images, and leave it off when it does not. Without
it, a tool that returns a picture delivers text in its place saying the image was
withheld and naming this setting — so a model that could have read one tells you,
instead of the picture disappearing. [Why the default is off](overview.md#why-vision-is-off-by-default).

## `provider`

Selects the client, not the vendor:

| Value | API | Credential | Endpoint |
| --- | --- | --- | --- |
| `openai` | Chat Completions (`/chat/completions`) | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `openai-responses` | OpenAI's Responses API (`/responses`) | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `openrouter` | Chat Completions | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `openrouter-responses` | Responses | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `orcarouter` | Chat Completions | `ORCAROUTER_API_KEY` | `https://api.orcarouter.ai/v1` |
| `orcarouter-responses` | Responses | `ORCAROUTER_API_KEY` | `https://api.orcarouter.ai/v1` |
| `anthropic` | Anthropic Messages | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| `github-copilot` | Copilot, over Chat Completions | `ATOMA_COPILOT_TOKEN` | `https://api.githubcopilot.com` |

**One provider, one credential, and the credential is what selects the provider**
when neither the agent definition nor the `ATOMA_PROVIDER` variable names one.
Add exactly the secret for the provider you intend to use. Adding two is an error
naming both, rather than a precedence that picks for you — before atoma v0.1.13,
`OPENAI_API_KEY` selected a client whose endpoint defaulted to OpenRouter, so the
name of the secret said nothing about where the key was sent.

Each endpoint moves with its own `*_BASE_URL` variable (`OPENROUTER_BASE_URL` and
so on), and [none of them may be declared in `tools.secrets`](boundaries.md).

Which of the two OpenAI entries to prefer, and how to reach a provider with no
row of its own, are in [docs/agents/tasks/](tasks).

## `extra_body`

Atoma merges every `extra_body` key straight into the request body, so what goes
there is the provider's own contract rather than an Atoma feature. The shipped
definitions use it for OpenRouter's provider routing; pinning an endpoint is in
[prefer particular upstream providers](tasks/prefer-particular-upstream-providers.md).

There is no `tools:` block in the shipped definitions, and
[that is deliberate](boundaries.md#why-there-is-no-provider-side-tool-block).

## Repository variables

Two repository **variables** — not secrets — both for reaching a provider
somewhere other than its default host:

- `ATOMA_PROVIDER` overrides the `provider` in an agent definition. One of the
  eight values in the table above, not two.
- `OPENAI_BASE_URL` moves OpenAI's endpoint only. Each provider has its own
  (`OPENROUTER_BASE_URL`, `ANTHROPIC_BASE_URL`, and so on), for the same reason
  each has its own credential. Reaching a provider the table does not list is
  [a task of its own](tasks/reach-a-provider-the-table-does-not-list.md).

Neither may be declared in `tools.secrets`; both are reserved for exactly that
reason.
