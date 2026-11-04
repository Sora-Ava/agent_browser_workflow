import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../server/app.ts";
import { Browser } from "../server/browser.ts";
import { listenLocal } from "../tests/support/listen.ts";
import { workflowSchema } from "../shared/workflow.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-graph-"));
const app = createApp(dir, `abw-graph-${Date.now()}`);
const ui = new Browser(join(dir, "ui"), `abw-graph-ui-${Date.now()}`);
let downloads = 0;
const site = createServer((req, res) => {
  if (req.url === "/file") {
    downloads++;
    res.setHeader("content-type", "text/csv");
    res.setHeader("content-disposition", 'attachment; filename="result.csv"');
    res.end("product\nA\n");
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><body><label>产品<input id="product"></label><button id="query" onclick="document.querySelector('#ready').hidden=true;setTimeout(()=>{document.querySelector('#empty').hidden=document.querySelector('#product').value!=='无数据';document.querySelector('#rows').hidden=!document.querySelector('#empty').hidden;document.querySelector('#ready').hidden=false},150)">查询</button><div id="ready" hidden>查询完成</div><div id="empty" hidden>暂无数据</div><div id="rows" hidden>产品A</div><a id="export" href="/file" download>导出</a></body>`,
  );
});
await listenLocal(site);
await listenLocal(app.server);
const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
const target = `http://127.0.0.1:${(site.address() as any).port}`;
const plain = app.store.save({
  name: "查询分支",
  startUrl: target,
  parameters: [{ name: "product", label: "产品", defaultValue: "无数据" }],
  steps: [
    { type: "fill", selector: "#product", value: { parameter: "product" } },
    { type: "click", selector: "#query" },
    { type: "download", selector: "#export", filename: "result.csv" },
  ],
});
const graph = workflowSchema.parse({
  ...plain,
  graph: {
    entry: "fill",
    nodes: [
      {
        id: "fill",
        label: "填写产品",
        kind: "action",
        stepIndex: 0,
        next: "query",
        x: 250,
        y: 35,
      },
      {
        id: "query",
        label: "点击查询",
        kind: "action",
        stepIndex: 1,
        next: "condition",
        x: 250,
        y: 145,
      },
      {
        id: "condition",
        label: "是否无数据",
        kind: "condition",
        test: "visible",
        readySelector: "#ready",
        selector: "#empty",
        yes: "empty",
        no: "export",
        x: 250,
        y: 255,
      },
      {
        id: "empty",
        label: "没有数据",
        kind: "end",
        message: "没有数据",
        status: "no_data",
        x: 40,
        y: 400,
      },
      {
        id: "export",
        label: "导出文件",
        kind: "action",
        stepIndex: 2,
        next: "done",
        x: 520,
        y: 400,
      },
      {
        id: "done",
        label: "完成",
        kind: "end",
        message: "导出完成",
        status: "succeeded",
        x: 520,
        y: 520,
      },
    ],
  },
});
const version = app.store.saveVersion(plain.id, graph);
async function api(path: string, body: any) {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as any;
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
async function until(check: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(message);
}
async function run(id: string, value: string) {
  await api("replay", { id, values: { product: value } });
  await until(
    async () =>
      !["running", "repairing", "pausing", "paused"].includes(
        ((await (await fetch(base + "/api/state")).json()) as any).active
          .status,
      ),
    "run timeout",
  );
  return ((await (await fetch(base + "/api/state")).json()) as any).active;
}
try {
  await app.config.update({
    baseUrl: "http://127.0.0.1:1/v1",
    model: "unreachable-must-not-call",
    apiKey: "",
    downloadDir: join(dir, "downloads"),
  });
  await ui.command(["open", base]);
  await ui.command(["set", "viewport", "1440", "1000"]);
  await ui.command(["wait", ".flow-short"]);
  await ui.command([
    "click",
    `.flow-short:nth-of-type(${app.store.list().findIndex((w) => w.id === version.id) + 1})`,
  ]);
  await ui.command(["wait", ".graph-heading button"]);
  assert.equal(
    (
      await ui.command([
        "eval",
        "document.body.innerText.includes('查看保存的')",
      ])
    ).result,
    false,
  );
  await ui.command(["click", '[data-node-id="fill"]']);
  assert.equal(
    (
      await ui.command([
        "eval",
        "document.querySelector('.node-actions').innerText.includes('单步测试')",
      ])
    ).result,
    true,
  );
  await ui.command(["click", '[data-node-id="empty"]']);
  assert.equal(
    (
      await ui.command([
        "eval",
        "document.querySelector('.node-actions') === null",
      ])
    ).result,
    true,
  );
  await ui.command(["click", 'text:{"text":"编辑流程图","match":"exact"}']);
  await ui.command(["scrollintoview", '[data-node-id="fill"]']);
  const rawRect = (
    await ui.command([
      "eval",
      `(()=>{const r=document.querySelector('[data-node-id="fill"]').getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()`,
    ])
  ).result;
  const parsedRect =
    typeof rawRect === "string" ? JSON.parse(rawRect) : rawRect;
  const rect = { x: Math.round(parsedRect.x), y: Math.round(parsedRect.y) };
  assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.y));
  await ui.command(["mouse", "move", String(rect.x), String(rect.y)]);
  await ui.command(["mouse", "down", "left"]);
  await ui.command(["mouse", "move", String(rect.x + 40), String(rect.y + 20)]);
  await ui.command(["mouse", "up", "left"]);
  await ui.command(["click", '[data-node-id="condition"]']);
  await ui.command(["select", '[aria-label="是 →"]', "empty"]);
  await ui.command(["select", '[aria-label="否 →"]', "export"]);
  // Add then delete an unfinished node; saving should not retain its empty action.
  await ui.command(["click", 'text:{"text":"添加动作节点","match":"exact"}']);
  await ui.command(["click", 'text:{"text":"删除此节点","match":"exact"}']);
  await ui.command(["click", '[data-node-id="empty"]']);
  await ui.command(["fill", ".graph-inspector textarea", "没有匹配的批次"]);
  await ui.command(["click", ".graph-panel .primary"]);
  await until(async () => app.store.list().length === 3, "graph save failed");
  const saved = app.store
    .list()
    .find((w) => w.id !== plain.id && w.id !== version.id)!;
  assert.equal(saved.steps.length, 3);
  assert.equal(saved.graph.nodes.find((n: any) => n.id === "fill").x, 290);
  assert.equal(saved.graph.nodes.find((n: any) => n.id === "fill").y, 55);
  assert.equal(
    app.store.get(version.id).graph!.nodes.find((n) => n.id === "empty")!.kind,
    "end",
  );
  await api("browser/start", { url: target });
  const empty = await run(saved.id, "无数据");
  assert.equal(empty.status, "no_data");
  assert.equal(empty.summary, "没有匹配的批次");
  assert.equal(empty.modelCalls, 0);
  assert.equal(downloads, 0);
  assert.equal(empty.nodeStates.empty.status, "succeeded");
  assert.equal(empty.nodeStates.export, undefined);
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          `document.querySelector('[data-node-id="empty"]')?.classList.contains('succeeded')`,
        ])
      ).result === true,
    "UI state missing",
  );
  await ui.command(["scrollintoview", ".graph-panel"]);
  await ui.command(["screenshot", resolve("data/ui-graph-empty.png")]);
  const data = await run(saved.id, "产品A");
  assert.equal(data.status, "succeeded");
  assert.equal(data.modelCalls, 0);
  assert.equal(downloads, 1);
  assert.equal(data.nodeStates.export.status, "succeeded");
  assert.equal(data.nodeStates.empty, undefined);
  assert.match(
    await readFile(join(dir, "downloads", "result.csv"), "utf8"),
    /product/,
  );
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          `document.querySelector('[data-node-id="done"]')?.classList.contains('succeeded')`,
        ])
      ).result === true,
    "UI data state missing",
  );
  await ui.command(["screenshot", resolve("data/ui-graph-data.png")]);
  await ui.command(["click", '[data-node-id="fill"]']);
  await ui.command(["eval", "window.confirm = () => true"]);
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          "Array.from(document.querySelectorAll('.node-actions button')).some(b => b.textContent.trim() === '单步测试' && !b.disabled)",
        ])
      ).result === true,
    "node action still disabled: 单步测试",
  );
  await ui.command(["click", 'text:{"text":"单步测试","match":"exact"}']);
  console.log("UI action: 单步测试");
  await until(async () => {
    const result = await app.browser.command(["get", "value", "#product"]);
    return result.value === "无数据";
  }, "node test did not execute selected fill");
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          "Array.from(document.querySelectorAll('.node-actions button')).some(b => b.textContent.trim() === '手动选元素' && !b.disabled)",
        ])
      ).result === true,
    "node action still disabled: 手动选元素",
  );
  await ui.command(["click", 'text:{"text":"手动选元素","match":"exact"}']);
  console.log("UI action: 手动选元素");
  await ui.command(["wait", "300"]);
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          "Array.from(document.querySelectorAll('.node-actions button')).some(b => b.textContent.trim() === '取消选择' && !b.disabled)",
        ])
      ).result === true,
    "node action still disabled: 取消选择",
  );
  await ui.command(["click", 'text:{"text":"取消选择","match":"exact"}']);
  console.log("UI action: 取消选择");
  await ui.command(["wait", "300"]);
  console.log(
    "PASS graph UI add/delete/save version, empty ends without download, data path downloads completed CSV, correct node highlights, 0 model calls, old sequential version preserved",
  );
} finally {
  await ui.command(["close"]).catch(() => {});
  await app.browser.command(["close"]).catch(() => {});
  app.server.close();
  site.close();
  app.store.db.close();
  await rm(dir, { recursive: true, force: true });
}
