# Run an agent on a different model

Edit `.github/atomaton/agent-definitions/<agent>.md` and change the frontmatter `model`
field.

Revisit `extra_body` at the same time — the endpoint names it lists are per-model.
See [prefer particular upstream providers](prefer-particular-upstream-providers.md).
The rest of the frontmatter an agent definition accepts is in
[the agent reference](../reference.md#model).
