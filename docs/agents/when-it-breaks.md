# When an agent will not start

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Agent exits immediately with a provider error | The credential is missing or invalid, or the `provider` in the agent definition is not the one the secret belongs to | Check the secret against [the provider the definition names](reference.md#provider). The runner resolves the provider before it builds anything, so a missing credential is named on the run rather than found by the agent — [step 3 of setup](../setup.md). This is also what half of [moving to a different provider](tasks/move-to-a-different-provider.md) looks like |
| `More than one provider credential is set` | Two providers' secrets are both present, so the credentials no longer decide which provider to use | Remove the one your repository does not use, or name the provider in the `ATOMA_PROVIDER` repository variable |
