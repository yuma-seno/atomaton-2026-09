# What an agent definition may not reach

## Moving an endpoint is moving a credential

A provider's `*_BASE_URL` variable may not be declared in `tools.secrets`, and
neither may `ATOMA_PROVIDER`. Both are reserved for that reason: the credential
is chosen by the provider, and the endpoint is where the credential is sent, so
anything that can move an endpoint into a tool's environment can send that
provider's key somewhere else.

## Why there is no provider-side tool block

The shipped agents declare no `tools:` block, so nothing triggers provider-side
tool dispatch. They used to declare `openrouter:web_search` and
`openrouter:web_fetch`, and both were removed: a provider-side tool reaches the
web outside this repository's own `web` server, so the request is not logged, the
response is not capped, and what an agent fetched cannot be read back from the
run log. Reaching the web through `web__fetch` is all three of those things.
