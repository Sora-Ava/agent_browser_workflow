import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLocatorPatch } from "../server/repair.ts";
import { runWorkflow } from "../server/engine.ts";
import type { Workflow } from "../shared/workflow.ts";

test("locator patches preserve parameter bindings and reject semantic changes", () => {
  const step = {
    type: "fill" as const,
    selector: "#old",
    value: { parameter: "product" },
  };
  assert.deepEqual(applyLocatorPatch(step, { selector: "#new" }), {
    ...step,
    selector: "#new",
  });
  assert.throws(() =>
    applyLocatorPatch(step, { selector: "#new", value: "other" }),
  );
  assert.throws(() => applyLocatorPatch(step, { selector: "@e1" }));
});
test("missing locator is repaired before dispatch, without repeating completed steps", async () => {
  const w: Workflow = {
    name: "repair",
    startUrl: "http://example.local",
    parameters: [],
    steps: [
      { type: "press", key: "Tab" },
      { type: "click", selector: "#old" },
    ],
  };
  const dispatched: string[][] = [];
  const result = await runWorkflow(
    w,
    {},
    {
      command: async (args) => {
        dispatched.push(args);
        return args[0] === "get" ? { count: args[2] === "#old" ? 0 : 1 } : {};
      },
    },
    {
      signal: new AbortController().signal,
      onStep: async () => {},
      repairStep: async (step) => applyLocatorPatch(step, { selector: "#new" }),
    },
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.repairs, 1);
  assert.equal(dispatched.filter((a) => a[0] === "press").length, 1);
  assert.deepEqual(
    dispatched.filter((a) => a[0] === "click"),
    [["click", "#new"]],
  );
  assert.equal(result.repairedWorkflow?.steps[1].type, "click");
});
test("possibly dispatched click failure is not replayed or repaired", async () => {
  let repairs = 0,
    clicks = 0;
  const w: Workflow = {
    name: "uncertain",
    startUrl: "http://example.local",
    parameters: [],
    steps: [{ type: "click", selector: "#submit" }],
  };
  await assert.rejects(
    runWorkflow(
      w,
      {},
      {
        command: async (args) => {
          if (args[0] === "get") return { count: 1 };
          if (args[0] === "click") {
            clicks++;
            throw new Error("connection lost");
          }
          return {};
        },
      },
      {
        signal: new AbortController().signal,
        onStep: async () => {},
        repairStep: async (s) => {
          repairs++;
          return s;
        },
      },
    ),
  );
  assert.equal(clicks, 1);
  assert.equal(repairs, 0);
});
test("locator repair stops after two attempts", async () => {
  let repairs = 0;
  const w: Workflow = {
    name: "budget",
    startUrl: "http://example.local",
    parameters: [],
    steps: [{ type: "click", selector: "#missing" }],
  };
  await assert.rejects(
    runWorkflow(
      w,
      {},
      { command: async (args) => (args[0] === "get" ? { count: 0 } : {}) },
      {
        signal: new AbortController().signal,
        onStep: async () => {},
        repairStep: async (s) => {
          repairs++;
          return applyLocatorPatch(s, { selector: "#still-missing" });
        },
      },
    ),
    /修复/,
  );
  assert.equal(repairs, 2);
});
