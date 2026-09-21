# Have a screenshot reach an agent as a picture

An agent gets pictures from a tool only when its definition says so:

```yaml
vision: true
```

Check the model first. On OrcaRouter, from the catalogue rather than a per-model
route — it has no `/models/<slug>/endpoints`, and asking for one answers
`model_not_found`:

```bash
curl -s https://api.orcarouter.ai/v1/models \
  -H "Authorization: Bearer $ORCAROUTER_API_KEY" \
  | jq '.data[] | select(.id == "<author>/<slug>") | .architecture.input_modalities'
```

The same entry carries `supported_endpoint_types`, which is what decides whether the
model answers on `/responses` at all. A model missing `openai-response` there fails a
Responses provider with `400 upstream_rejected_request` — an error that reads as the
request being malformed rather than as the model being unreachable by that route.

Leaving it off loses nothing silently: a tool that returns a picture delivers text in
its place saying the image was withheld and naming this setting. Setting it on a model
that cannot read images is the expensive mistake — an API error that loses the run.

How the shipped agents are set, and why the default is off rather than on, is in
[docs/configuration.md](../../configuration.md).
