# Prefer particular upstream providers

On OpenRouter. Agent definitions ship an `extra_body` block, and Atoma merges every
key in it straight into the request body, so this is OpenRouter's own provider-routing
contract rather than an Atoma feature:

```yaml
extra_body:
  provider:
    order:
      - Xiaomi
      - Parasail
      - Novita
```

`order` puts the endpoints with the best uptime first, while OpenRouter stays free to
route elsewhere. Note that this nested `provider:` is unrelated to the top-level one,
which selects Atoma's client.

**Do not add `allow_fallbacks: false` or `require_parameters: true`.** They look like
the natural way to make `order` binding, and they break every request as soon as any
provider-side tool is declared. Server tools are executed by OpenRouter above provider
selection, and no endpoint advertises them in `supported_parameters`, so hard-pinning
the route leaves that layer nowhere to dispatch: every run then fails on its first
inference call with `Server tool request failed` (HTTP 404, `provider_name: null`).
Keep this list advisory.

A single unhealthy endpoint shows up as hung requests, truncated response bodies, and
contentless completions. List the current endpoints and their uptime with:

```bash
curl -s https://openrouter.ai/api/v1/models/<author>/<slug>/endpoints
```

Adjust `order` whenever you change `model`, since the endpoint names are per-model.
