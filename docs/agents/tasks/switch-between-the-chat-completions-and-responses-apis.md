# Switch between the Chat Completions and Responses APIs

The frontmatter `provider` field selects the client, not the vendor. Each vendor has a
pair: `openai` and `openai-responses`, `openrouter` and `openrouter-responses`, and so
on.

**Prefer the Chat Completions member of the pair.** It is what vLLM, Ollama, LM Studio,
Azure and every gateway built to that shape accept, so it is the one that keeps your
choice of host open.

The Responses variants earn their place in one case — **a tool that returns an image**.
Chat Completions cannot carry a picture in a tool result at all, so on that route the
image is moved into a following message; the Responses API's `function_call_output`
takes it directly. If your agents never receive pictures, the two behave alike.

The eight values, the credential each reads and the endpoint each defaults to are the
provider table in [the agent reference](../reference.md#provider).
