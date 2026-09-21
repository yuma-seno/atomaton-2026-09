# Move to a different provider

Two edits, and they have to happen together.

1. Change `provider` in every definition under
   `.github/atomaton/agent-definitions/`. The eight values, and the credential
   each one reads, are in [the provider
   table](../reference.md#provider) — or set the `ATOMA_PROVIDER` repository
   variable, which overrides all of them at once.
2. Add that provider's own secret, and remove the one you are leaving —
   [having two set is an error rather than a
   precedence](../reference.md#provider).

Make only one of the two and nothing starts; what you see then, and where it says
so, is [when an agent will not start](../when-it-breaks.md). It costs a dispatch
rather than a runner — nothing has been installed and no agent has begun — so add
the missing secret and ask again.

Three choices sit next to this one and are not the same choice:

- Staying with the shipped provider and moving **model** instead is [run an agent
  on a different model](run-an-agent-on-a-different-model.md), and one line in
  one definition. [Why the shipped provider is a
  recommendation](../overview.md#why-the-shipped-provider-is-a-recommendation) is
  the argument for reaching for that one first.
- Moving between the two OpenAI-shaped dialects, without changing vendor, is
  [switch between the Chat Completions and Responses
  APIs](switch-between-the-chat-completions-and-responses-apis.md).
- A provider with no row of its own is [reach a provider the table does not
  list](reach-a-provider-the-table-does-not-list.md), which is a base URL rather
  than a `provider` value.
