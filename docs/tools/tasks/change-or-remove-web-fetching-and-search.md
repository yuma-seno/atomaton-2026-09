# Change or remove web fetching and search

Searching is a skill rather than a tool.
`.github/atomaton/skills/research/web-search.md` tells agents to fetch a search engine's
results page and read the links out of it. The endpoint lives in that file on purpose:

- To use a different service — one with an API key, or your own instance — edit the
  skill. The tool fetches whatever URL it is handed, so nothing else changes.
- To stop agents querying a public search engine at all, delete that section of the
  skill. Fetching a page whose address is already known keeps working.
- To remove web access entirely, drop `web` from `mcp_servers` in the agent definitions
  that name it. That is the whole of it, and there is nothing to delete in
  `config.yaml`: `web` is one of the servers Atomaton ships, and a server no agent names is
  never started.

This is separate from the search over your repository's own issues, which is a tool
server — [searching your repository's issues](../how-it-works/searching-the-issues.md).
