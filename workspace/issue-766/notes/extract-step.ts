#!/usr/bin/env bun
/** Reads the check step's bash out of the generated workflow. */
const doc = Bun.YAML.parse(await Bun.file("dist/.github/workflows/atomaton-runner.yml").text()) as any;
const step = doc.jobs.run.steps.find((s: any) => s.name === "Check the resolved provider has a credential");
await Bun.write("/tmp/step-run.sh", step.run);
console.log("ok");
