import { test } from "node:test";
import assert from "node:assert/strict";
import { workflowSchema, bindValue } from "../shared/workflow.ts";
import { runWorkflow, executeStep } from "../server/engine.ts";

test("stringified credential references bind values and retain credential origin checks", async () => {
  for (const [literal, key] of [
    [`{credential:"username"}`, "username"],
    [`{"credential":"password"}`, "password"],
  ] as const) {
    const commands: string[][] = [];
    const credential = {
      origin: "https://example.local",
      username: "fixture-user",
      password: "fixture-password",
    };
    const browser = {
      command: async (args: string[]) => {
        commands.push(args);
        return { url: "https://example.local/login" };
      },
    };
    const step = { type: "fill" as const, selector: "#input", value: literal };
    await executeStep(step, {}, browser, {
      credential,
      signal: new AbortController().signal,
      onStep: async () => {},
    });
    assert.deepEqual(commands.at(-1), ["fill", "#input", credential[key]]);
    const parsed = workflowSchema.parse({
      name: "登录",
      startUrl: credential.origin,
      parameters: [],
      steps: [step],
    });
    assert.deepEqual((parsed.steps[0] as any).value, { credential: key });
    commands.length = 0;
    await assert.rejects(
      executeStep(step, {}, browser, {
        credential: { ...credential, origin: "https://other.local" },
        signal: new AbortController().signal,
        onStep: async () => {},
      }),
      /不一致/,
    );
    assert.equal(
      commands.some((a) => a[0] === "fill"),
      false,
    );
  }
});

const workflow = () => ({
  name: "产品查询",
  startUrl: "http://127.0.0.1:3001/demo",
  parameters: [{ name: "product", label: "产品名称", defaultValue: "产品 A" }],
  steps: [
    { type: "fill", selector: "#product", value: { parameter: "product" } },
    { type: "click", selector: "#search" },
    { type: "wait", selector: "#ready" },
    { type: "checkResults", emptySelector: "#empty", dataSelector: "#rows" },
    { type: "extract", selector: "#rows" },
  ],
});

test("replay binds changed input and finishes no_data only after query readiness", async () => {
  const visited: string[][] = [];
  const browser = {
    command: async (args: string[]) => {
      visited.push(args);
      if (args[0] === "is") return { visible: args[2] === "#empty" };
      return {};
    },
  };
  const result = await runWorkflow(
    workflowSchema.parse(workflow()),
    { product: "产品 B" },
    browser,
    { signal: new AbortController().signal, onStep: async () => {} },
  );
  assert.equal(result.status, "no_data");
  assert.deepEqual(visited.slice(1, 4), [
    ["fill", "#product", "产品 B"],
    ["click", "#search"],
    ["wait", "#ready"],
  ]);
  assert.equal(
    visited.some((args) => args[0] === "get"),
    false,
  );
});
test("flow rejects ephemeral refs and undeclared parameter bindings", () => {
  const w = workflow();
  w.steps[0].selector = "@e1";
  assert.throws(() => workflowSchema.parse(w));
  const other = workflow();
  (other.steps[0].value as { parameter: string }).parameter = "unknown";
  assert.throws(() => workflowSchema.parse(other));
});
test("binding distinguishes empty valid input from a missing value", () => {
  assert.equal(bindValue({ parameter: "name" }, { name: "" }), "");
  assert.throws(() => bindValue({ parameter: "name" }, {}));
});
test("cancelled run performs no browser actions", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runWorkflow(
      workflowSchema.parse(workflow()),
      { product: "B" },
      {
        command: async () => {
          assert.fail("browser executed");
        },
      },
      { signal: controller.signal, onStep: async () => {} },
    ),
  );
});
test("login skips credential submission when logged-in marker is visible", async () => {
  const w = {
    name: "登录",
    startUrl: "http://example.local",
    parameters: [],
    steps: [
      {
        type: "login",
        usernameSelector: "#user",
        passwordSelector: "#pass",
        submitSelector: "#submit",
        successSelector: "#app",
      },
    ],
  };
  const commands: string[][] = [];
  const result = await runWorkflow(
    workflowSchema.parse(w),
    {},
    {
      command: async (args: string[]) => {
        commands.push(args);
        return args[0] === "is" ? { visible: true } : {};
      },
    },
    { signal: new AbortController().signal, onStep: async () => {} },
  );
  assert.equal(result.status, "succeeded");
  assert.equal(
    commands.some((a) => a[0] === "fill"),
    false,
  );
});
test("ambiguous query state fails instead of claiming no data", async () => {
  await assert.rejects(
    runWorkflow(
      workflowSchema.parse(workflow()),
      { product: "B" },
      {
        command: async (args: string[]) =>
          args[0] === "is" ? { visible: false } : {},
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    ),
    /查询状态不明确/,
  );
});
