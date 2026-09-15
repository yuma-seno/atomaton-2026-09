import { describe, expect, test } from "bun:test";
import { buildArgv } from "./get_config_value.ts";

describe("get_config_value.ts buildArgv", () => {
  test("quotes path and fallback", () => {
    expect(buildArgv("chain.after_handoffs", "5")).toEqual(['"chain.after_handoffs"', '"5"']);
  });
  test("omits fallback when not given", () => {
    expect(buildArgv("chain.labels.in_progress")).toEqual(['"chain.labels.in_progress"']);
  });
});
