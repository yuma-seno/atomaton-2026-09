# Reading the web

`web__fetch` retrieves a URL and returns the page as Markdown, so an agent gets
prose rather than markup; `raw: true` returns the markup, and a URL that
resolves to an image comes back as an image for agents with
[`vision: true`](../../agents/reference.md#vision).

Searching is a skill rather than a tool:
`.github/atomaton/skills/research/web-search.md` tells agents to fetch a search
engine's results page and read the links out of it. Changing or removing that is
[change or remove web fetching and search](../tasks/change-or-remove-web-fetching-and-search.md).

Being a skill rather than a tool is also how it reaches an agent at all. A skill's
metadata is listed in the prompt; its body arrives only when the agent asks for it
by name with `atoma_builtin__load_skill`, so a skill nobody loads costs nothing but
the line that names it.
