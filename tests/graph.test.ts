import { test } from "node:test";
import assert from "node:assert/strict";
import { workflowSchema } from "../shared/workflow.ts";
import { toGraph, compactGraphWorkflow } from "../shared/graph.ts";
import { runWorkflow } from "../server/engine.ts";
const base = () =>
  workflowSchema.parse({
    name: "查询",
    startUrl: "https://example.local",
    parameters: [],
    steps: [{ type: "click", selector: "#export" }],
    graph: {
      entry: "condition",
      nodes: [
        {
          id: "condition",
          label: "是否无数据",
          kind: "condition",
          test: "visible",
          readySelector: "#ready",
          selector: "#empty",
          yes: "empty",
          no: "export",
        },
        {
          id: "empty",
          label: "结束",
          kind: "end",
          message: "没有数据",
          status: "no_data",
        },
        {
          id: "export",
          label: "导出",
          kind: "action",
          stepIndex: 0,
          next: "done",
        },
        {
          id: "done",
          label: "结束",
          kind: "end",
          message: "导出完成",
          status: "succeeded",
        },
      ],
    },
  });
test("deleted unfinished actions do not block graph save; referenced invalid actions still fail", () => {
  const flow = base();
  flow.steps.push({ type: "click", selector: "" });
  assert.doesNotThrow(() => workflowSchema.parse(compactGraphWorkflow(flow)));
  flow.graph!.nodes = flow.graph!.nodes.map((n) =>
    n.kind === "action" ? { ...n, stepIndex: 1 } : n,
  );
  assert.throws(() => workflowSchema.parse(compactGraphWorkflow(flow)));
});
test("end-only graphs are valid; empty legacy workflows are rejected", () => {
  const flow = {
    name: "结束",
    startUrl: "https://example.local",
    parameters: [],
    steps: [],
  };
  assert.throws(() => workflowSchema.parse(flow));
  assert.doesNotThrow(() =>
    workflowSchema.parse({
      ...flow,
      graph: {
        entry: "end",
        nodes: [
          {
            id: "end",
            label: "结束",
            kind: "end",
            status: "succeeded",
            message: "完成",
          },
        ],
      },
    }),
  );
});
test("graph conversion preserves legacy steps; validation rejects cycles, missing edges and unreachable nodes", () => {
  const w = base();
  const plain = { ...w, graph: undefined };
  assert.equal(toGraph(plain).nodes.length, 2);
  assert.throws(() =>
    workflowSchema.parse({
      ...w,
      graph: {
        ...w.graph,
        nodes: w.graph!.nodes.map((n) =>
          n.id === "export" ? { ...n, next: "missing" } : n,
        ),
      },
    }),
  );
  assert.throws(() =>
    workflowSchema.parse({
      ...w,
      graph: {
        ...w.graph,
        nodes: w.graph!.nodes.map((n) =>
          n.id === "export" ? { ...n, next: "condition" } : n,
        ),
      },
    }),
  );
  assert.throws(() =>
    workflowSchema.parse({
      ...w,
      graph: {
        ...w.graph,
        nodes: [
          ...w.graph!.nodes,
          {
            id: "unused",
            label: "孤立",
            kind: "end",
            message: "",
            status: "succeeded",
          },
        ],
      },
    }),
  );
});
for (const empty of [true, false])
  test(`graph chooses only ${empty ? "empty" : "export"} path without model`, async () => {
    const commands: string[][] = [];
    const events: any[] = [];
    const result = await runWorkflow(
      base(),
      {},
      {
        command: async (args) => {
          commands.push(args);
          return args[0] === "get"
            ? { count: 1 }
            : args[0] === "is"
              ? { visible: empty }
              : {};
        },
      },
      {
        signal: new AbortController().signal,
        onStep: async () => {},
        onNode: async (e) => {
          events.push(e);
        },
      },
    );
    assert.equal(result.status, empty ? "no_data" : "succeeded");
    assert.equal(
      commands.some((a) => a[0] === "click"),
      !empty,
    );
    assert.ok(
      events.some((e) => e.nodeId === "condition" && e.status === "succeeded"),
    );
  });
test("condition readiness failure stops before choosing a branch", async () => {
  const commands: string[][] = [];
  await assert.rejects(
    runWorkflow(
      base(),
      {},
      {
        command: async (args) => {
          commands.push(args);
          if (args[0] === "wait") throw new Error("timeout");
          return {};
        },
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    ),
    /timeout/,
  );
  assert.equal(
    commands.some((a) => a[0] === "click"),
    false,
  );
});
for (const matched of [true, false])
  test(`text predicate takes ${matched ? "yes" : "no"} edge`, async () => {
    const flow = base();
    flow.graph!.nodes = flow.graph!.nodes.map((n) =>
      n.kind === "condition"
        ? { ...n, test: "textContains", text: "暂无数据" }
        : n,
    );
    const result = await runWorkflow(
      flow,
      {},
      {
        command: async (a) =>
          a[0] === "get"
            ? a[1] === "count"
              ? { count: 1 }
              : { text: matched ? "当前暂无数据" : "已查询到产品" }
            : a[0] === "is"
              ? { visible: true }
              : {},
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    );
    assert.equal(result.status, matched ? "no_data" : "succeeded");
  });
test("ambiguous condition fails rather than selecting a no-data edge", async () => {
  const commands: string[][] = [];
  await assert.rejects(
    runWorkflow(
      base(),
      {},
      {
        command: async (a) => {
          commands.push(a);
          return a[0] === "get" ? { count: a[2] === "#empty" ? 2 : 1 } : {};
        },
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    ),
    /不唯一/,
  );
  assert.equal(
    commands.some((a) => a[0] === "click"),
    false,
  );
});
test("cancellation at node boundary prevents condition commands", async () => {
  const controller = new AbortController();
  const commands: string[][] = [];
  await assert.rejects(
    runWorkflow(
      base(),
      {},
      {
        command: async (a) => {
          commands.push(a);
          return {};
        },
      },
      {
        signal: controller.signal,
        onStep: async () => {},
        onNode: async () => {
          controller.abort();
        },
      },
    ),
  );
  assert.deepEqual(commands, [["open", "https://example.local"]]);
});
test("invalid graph is rejected before opening browser", async () => {
  const flow = base();
  flow.graph!.entry = "missing";
  let commands = 0;
  await assert.rejects(
    runWorkflow(
      flow,
      {},
      {
        command: async () => {
          commands++;
          return {};
        },
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    ),
  );
  assert.equal(commands, 0);
});
test("invalid visible state is a failure, not a false branch", async () => {
  const states: any[] = [];
  await assert.rejects(
    runWorkflow(
      base(),
      {},
      { command: async (a) => (a[0] === "get" ? { count: 1 } : {}) },
      {
        signal: new AbortController().signal,
        onStep: async () => {},
        onNode: async (e) => {
          states.push(e);
        },
      },
    ),
    /可见状态无效/,
  );
  assert.equal(states.at(-1).status, "failed");
  assert.equal(states.at(-1).nodeId, "condition");
});
test("parameter editing preserves graph references", () => {
  const w = base();
  const parsed = workflowSchema.parse({ ...w, name: "新名称" });
  assert.deepEqual(parsed.graph, w.graph);
});
test("missing condition target fails instead of assuming the no branch", async () => {
  const commands: string[][] = [];
  await assert.rejects(
    runWorkflow(
      base(),
      {},
      {
        command: async (a) => {
          commands.push(a);
          return a[0] === "get" ? { count: a[2] === "#empty" ? 0 : 1 } : {};
        },
      },
      { signal: new AbortController().signal, onStep: async () => {} },
    ),
    /不存在/,
  );
  assert.equal(
    commands.some((a) => a[0] === "click"),
    false,
  );
});
