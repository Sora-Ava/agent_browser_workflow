import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.ts";
import { demoWorkflow } from "../shared/demo-workflow.ts";

const dir = await mkdtemp(join(tmpdir(), "abw-real-"));
const app = createApp(dir, `abw-smoke-${Date.now()}`);
await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
const port = (app.server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(base + "/api/" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as any;
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function waitRun() {
  for (let i = 0; i < 150; i++) {
    const { active } = await api("state");
    if (active.status !== "running") return active;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("run timeout");
}
try {
  await app.config.update({
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "",
    model: "intentionally-unreachable",
    downloadDir: join(dir, "downloads"),
  });
  const credentialId = await app.config.saveCredential({
    origin: base,
    alias: "test",
    username: "demo",
    password: "demo123",
  });
  await app.browser.command(["open", base + "/demo"]);
  const observation = await app.browser.observe();
  const targets =
    typeof observation.targets === "string"
      ? JSON.parse(observation.targets)
      : observation.targets;
  assert.ok(
    targets.some((t: any) => t.selector === "#ready"),
    "query-ready container must be discoverable",
  );
  assert.ok(
    targets.some((t: any) => t.selector === "#empty"),
    "hidden no-data state must be discoverable",
  );
  const saved = await api("workflows", "POST", {
    ...demoWorkflow,
    startUrl: base + "/demo",
  });
  await api("replay", "POST", {
    id: saved.id,
    credentialId,
    values: { product_name: "产品 B" },
  });
  const run = await waitRun();
  assert.equal(run.status, "succeeded", run.error);
  assert.equal(run.modelCalls, 0);
  const csv = await readFile(join(dir, "downloads", "products.csv"), "utf8");
  assert.match(csv, /产品 B/);
  console.log(
    "PASS real browser: login, parameter B, query readiness, extraction and completed CSV download, 0 model calls",
  );
  await api("replay", "POST", {
    id: saved.id,
    credentialId,
    values: { product_name: "产品 A" },
  });
  const second = await waitRun();
  assert.equal(second.status, "succeeded", second.error);
  assert.equal(second.events[0].output.alreadyLoggedIn, true);
  assert.equal((await readdir(join(dir, "downloads"))).length, 2);
  console.log("PASS persisted login and non-overwriting downloads");
  await api("replay", "POST", {
    id: saved.id,
    credentialId,
    values: { product_name: "不存在的产品" },
  });
  const empty = await waitRun();
  assert.equal(empty.status, "no_data", empty.error);
  assert.equal(empty.modelCalls, 0);
  assert.equal((await readdir(join(dir, "downloads"))).length, 2);
  console.log(
    "PASS no-data is a normal terminal state without download or model calls",
  );
  const frame = await fetch(base + "/api/frame");
  assert.equal(frame.headers.get("content-type"), "image/png");
  assert.ok((await frame.arrayBuffer()).byteLength > 1000);
  // Contract test only: a scripted local provider replaces paid inference.
  // The browser actions, HTTP service, recorder and parameter binding are real.
  const transcript: any[] = [
    ["observe", {}],
    ...demoWorkflow.steps.map((s) => [
      "act",
      { step: s.type === "fill" ? { ...s, value: "产品 A" } : s },
    ]),
    [
      "finish",
      {
        name: "探索录制测试",
        parameters: [
          {
            name: "product_name",
            label: "产品名称",
            defaultValue: "产品 A",
            stepIndexes: [1],
          },
        ],
      },
    ],
  ];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    assert.equal(request.tools[1].function.parameters.type, "object");
    const [name, args] = transcript.shift();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-" + transcript.length,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  try {
    await app.config.update({
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      apiKey: "",
      model: "scripted-contract-provider",
      downloadDir: join(dir, "downloads"),
    });
    await api("explore", "POST", {
      startUrl: base + "/demo",
      credentialId,
      instruction: "查询产品 A 并导出",
    });
    const explored = await waitRun();
    assert.equal(explored.status, "succeeded", explored.error);
    assert.equal(explored.draft.steps[1].value.parameter, "product_name");
    assert.equal(explored.draft.steps.length, 7);
    assert.equal(explored.modelCalls, 9);
    const captured = await api("workflows", "POST", explored.draft);
    assert.ok(captured.id);
    console.log(
      "PASS scripted-provider contract: exploration tools, real browser execution, draft parameter binding and save (not a live LLM evaluation)",
    );
  } finally {
    await new Promise<void>((r) => provider.close(() => r()));
  }
} finally {
  await app.browser.command(["close"]).catch(() => {});
  await new Promise<void>((r) => app.server.close(() => r()));
  app.store.db.close();
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
