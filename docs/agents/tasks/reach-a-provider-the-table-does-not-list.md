# Reach a provider the table does not list

Set `provider: openai` and point the `OPENAI_BASE_URL` repository variable at any host
serving the endpoint you picked — not every OpenAI-compatible gateway implements
`/responses`.

What you give up by doing that instead of naming a provider is that the run's log says
`openai`, so where it went is only visible in the variable. **This repository's own
agent definitions were that case**, reading `provider: openai-responses # openrouter`
— and the trailing comment was there because the name did not say where the request
went. They name `orcarouter-responses` now.

Each endpoint moves with its own `*_BASE_URL` variable (`OPENROUTER_BASE_URL` and so
on), and it is a repository variable rather than a secret. None of them may be declared
in `tools.secrets`: moving a provider's endpoint is a way to send its credential
somewhere else.
