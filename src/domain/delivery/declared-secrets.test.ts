import { describe, expect, test } from "bun:test";
import {
  DEPLOY_JOB_RESERVED,
  resolveDeclaredSecrets,
  SECRET_SLOTS,
  TOOL_SECRETS,
} from "./declared-secrets.ts";

/** What a deployment's own entry gets, named for the entry it came from. */
const DEPLOY_ENTRY = { field: "deploy.on_merge[0].secrets", reserved: DEPLOY_JOB_RESERVED };

describe("resolveDeclaredSecrets", () => {
  test("no declaration is the normal case, not a problem", () => {
    for (const raw of [undefined, null, []]) {
      expect(resolveDeclaredSecrets(raw, TOOL_SECRETS)).toEqual({ names: [], problems: [] });
    }
  });

  test("keeps declared names in slot order", () => {
    const { names, problems } = resolveDeclaredSecrets(["SLACK_TOKEN", "JIRA_API_TOKEN"], TOOL_SECRETS);
    expect(problems).toEqual([]);
    expect(names).toEqual(["SLACK_TOKEN", "JIRA_API_TOKEN"]);
  });

  test("tolerates surrounding whitespace", () => {
    expect(resolveDeclaredSecrets(["  SLACK_TOKEN  "], TOOL_SECRETS).names).toEqual(["SLACK_TOKEN"]);
  });

  // Lowercase is rejected rather than normalised: GitHub would accept both
  // spellings as one secret, and this would read them as two declarations.
  test("rejects names that are not shaped like an environment variable", () => {
    for (const bad of ["slack_token", "1TOKEN", "SLACK-TOKEN", "SLACK TOKEN", ""]) {
      const { names, problems } = resolveDeclaredSecrets([bad], TOOL_SECRETS);
      expect(names, bad).toEqual([]);
      expect(problems.length, bad).toBe(1);
    }
  });

  test("rejects non-strings", () => {
    expect(resolveDeclaredSecrets([42], TOOL_SECRETS).problems).toHaveLength(1);
  });

  // The whole point of the reserved list: this would have replaced the run's own
  // token with an adopter-supplied value instead of adding a credential.
  test("rejects a name the destination already uses for itself", () => {
    for (const reserved of ["GH_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ISSUE_NUMBER"]) {
      const { names, problems } = resolveDeclaredSecrets([reserved], TOOL_SECRETS);
      expect(names, reserved).toEqual([]);
      expect(problems[0], reserved).toContain(reserved);
    }
  });

  // Each destination guards its own environment, so the reserved set differs.
  // A deployment never sees the provider key, and may legitimately carry one.
  test("what is reserved depends on the destination", () => {
    expect(resolveDeclaredSecrets(["OPENAI_API_KEY"], DEPLOY_ENTRY).names).toEqual(["OPENAI_API_KEY"]);
    expect(resolveDeclaredSecrets(["ATOMATON_DEPLOY_TARGET"], DEPLOY_ENTRY).problems).toHaveLength(1);
    expect(resolveDeclaredSecrets(["ATOMATON_DEPLOY_TARGET"], TOOL_SECRETS).names).toEqual(["ATOMATON_DEPLOY_TARGET"]);
  });

  // The field is per call, not per reserved set, so an entry's problem names the
  // entry. "deploy declares a bad secret" leaves somebody reading three lists.
  test("every message names the field it came from", () => {
    expect(resolveDeclaredSecrets(["bad name"], TOOL_SECRETS).problems[0]).toContain("tools.secrets");
    expect(resolveDeclaredSecrets(["bad name"], DEPLOY_ENTRY).problems[0]).toContain("deploy.on_merge[0].secrets");
  });

  test("rejects a name that collides with the internal slots", () => {
    expect(resolveDeclaredSecrets(["ATOMATON_SECRET_0"], TOOL_SECRETS).problems).toHaveLength(1);
  });

  test("rejects a duplicate", () => {
    const { names, problems } = resolveDeclaredSecrets(["SLACK_TOKEN", "SLACK_TOKEN"], TOOL_SECRETS);
    expect(names).toEqual([]);
    expect(problems[0]).toContain("more than once");
  });

  test("fills every slot but refuses one more", () => {
    const fits = Array.from({ length: SECRET_SLOTS }, (_, i) => `TOKEN_${i}`);
    expect(resolveDeclaredSecrets(fits, TOOL_SECRETS).names).toHaveLength(SECRET_SLOTS);

    const { names, problems } = resolveDeclaredSecrets([...fits, "ONE_TOO_MANY"], TOOL_SECRETS);
    expect(names).toEqual([]);
    expect(problems[0]).toContain(String(SECRET_SLOTS));
  });

  test("rejects a declaration that is not an array", () => {
    expect(resolveDeclaredSecrets("SLACK_TOKEN", TOOL_SECRETS).problems).toHaveLength(1);
  });

  // A partially applied list would give the process a runtime failure instead of
  // a configuration error, so one bad entry withholds all of them.
  test("reports every problem at once and returns no names", () => {
    const { names, problems } = resolveDeclaredSecrets(["SLACK_TOKEN", "bad name", "GH_TOKEN"], TOOL_SECRETS);
    expect(names).toEqual([]);
    expect(problems).toHaveLength(2);
  });
});

// `isSecretDestinationName` was here, guarding a `--destination` flag that chose
// between `tools.secrets` and a deploy-wide `secrets` list. The second is gone: a
// deployment names its credentials on the entry that uses them, so there is one
// whole-workflow list left and nothing to choose between.
