import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { listenLocal } from "../tests/support/listen.ts";
import { Browser } from "../server/browser.ts";
import { runWorkflow } from "../server/engine.ts";
import { workflowSchema } from "../shared/workflow.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-text-"));
const browser = new Browser(dir, `abw-text-${Date.now()}`);
const server = createServer((_, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><body>
<div role="tab" onclick="document.body.dataset.clicked='menu'"><span> 菜单 </span></div>
<label for="direction"><span>追溯方向</span></label><input id="direction" onclick="document.body.dataset.clicked='direction'">
<div><span>追溯层级</span><div><input onclick="document.body.dataset.clicked='level'"></div></div>
<div onclick="document.body.dataset.clicked='card'"><span>生产报表</span></div>
<section><h2>区域甲</h2><button onclick="document.body.dataset.clicked='a'"><span>导出</span></button></section>
<section><h2>区域乙</h2><button onclick="document.body.dataset.clicked='b'">导出</button></section>
<button style="display:none">菜单</button><button onclick="document.body.dataset.clicked='partial'">查询产品数据</button>
<script>document.body.dataset.clicked='none'</script>`);
});
await listenLocal(server);
const url = `http://127.0.0.1:${(server.address() as any).port}`;
const loc = (text: string, extra = {}) =>
  "text:" + JSON.stringify({ text, ...extra });
const clicked = async () =>
  (await browser.command(["eval", "document.body.dataset.clicked"])).result;
try {
  await browser.command(["open", url]);
  await browser.command(["click", loc("菜单", { role: "tab" })]);
  assert.equal(await clicked(), "menu");
  await browser.command(["click", loc("追溯方向")]);
  assert.equal(await clicked(), "direction");
  await browser.command(["click", loc("追溯层级")]);
  assert.equal(await clicked(), "level");
  await browser.command(["click", loc("生产报表")]);
  assert.equal(await clicked(), "card");
  await assert.rejects(browser.command(["click", loc("导出")]), /匹配 2/);
  assert.equal(await clicked(), "card");
  await browser.command(["click", loc("导出", { scope: "区域乙" })]);
  assert.equal(await clicked(), "b");
  await browser.command(["click", loc("查询产品")]);
  assert.equal(await clicked(), "partial");
  await assert.rejects(
    browser.command(["click", loc("查询产品", { match: "exact" })]),
    /匹配 0/,
  );
  const flow = workflowSchema.parse({
    name: "文字重放",
    startUrl: url,
    parameters: [],
    steps: [{ type: "click", selector: loc("菜单", { role: "tab" }) }],
  });
  await runWorkflow(flow, {}, browser, {
    signal: new AbortController().signal,
    onStep: async () => {},
  });
  assert.equal(await clicked(), "menu");
  console.log(
    "PASS real browser: nested span/tab, linked label, hidden exclusion, ambiguity blocked, scope, partial fallback, exact-only, model-free replay",
  );
} finally {
  await browser.command(["close"]).catch(() => {});
  server.close();
  await rm(dir, { recursive: true, force: true });
}
