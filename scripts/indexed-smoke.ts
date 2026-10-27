import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Browser } from "../server/browser.ts";
import { executeStep, runWorkflow } from "../server/engine.ts";
import { workflowSchema } from "../shared/workflow.ts";
import { listenLocal } from "../tests/support/listen.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-index-real-"));
const browser = new Browser(dir, `abw-index-${Date.now()}`);
const site = createServer((_, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><body>
<div role="tab" onclick="document.body.dataset.clicked='menu'"><span>菜单</span></div>
<section><h2>区域甲</h2><button onclick="document.body.dataset.clicked='a'">导出</button></section>
<section><h2>区域乙</h2><button onclick="document.body.dataset.clicked='b'">导出</button></section>
<label for="batch">追溯批次</label><input id="batch">
<div style="cursor:pointer" onclick="document.body.dataset.clicked='card'"><span>生产报表</span></div>
<button hidden>隐藏按钮</button><button disabled>禁用按钮</button>
<div id="change"><button onclick="document.body.dataset.clicked='stale'">重绘按钮</button></div>
<button>同名</button><button>同名</button>
<button data-testid="keep">相同操作</button><button data-testid="remove">相同操作</button>
</body>`);
});
await listenLocal(site);
const url = `http://127.0.0.1:${(site.address() as any).port}`;
const opts = { signal: new AbortController().signal, onStep: async () => {} };
try {
  await browser.command(["open", url]);
  let observation = await browser.observe();
  const element = (name: string, region?: string) =>
    observation.elements.find(
      (e: any) => e.name === name && (!region || e.region === region),
    )!;
  assert.ok(element("菜单"));
  assert.ok(element("追溯批次"));
  assert.equal(
    observation.elements.some((e: any) => /隐藏按钮|禁用按钮/.test(e.name)),
    false,
  );
  const prepared = await browser.prepareIndexed(
    observation.observationId,
    element("菜单").index,
  );
  const recorded = workflowSchema.parse({
    name: "菜单",
    startUrl: url,
    parameters: [],
    steps: [{ type: "click", selector: prepared.locator }],
  });
  assert.equal(JSON.stringify(recorded).includes("data-abw-index"), false);
  await executeStep(
    { type: "click", selector: prepared.selector },
    {},
    browser,
    opts,
  );
  assert.equal(
    (await browser.command(["eval", "document.body.dataset.clicked"])).result,
    "menu",
  );
  await assert.rejects(
    browser.prepareIndexed(observation.observationId, 1),
    /失效/,
  );
  observation = await browser.observe();
  const batch = await browser.prepareIndexed(
    observation.observationId,
    element("追溯批次").index,
  );
  const parameterized = workflowSchema.parse({
    name: "批次",
    startUrl: url,
    parameters: [{ name: "batch", label: "批次", defaultValue: "A" }],
    steps: [
      { type: "fill", selector: batch.locator, value: { parameter: "batch" } },
    ],
  });
  await executeStep(
    { type: "fill", selector: batch.selector, value: "A" },
    {},
    browser,
    opts,
  );
  await runWorkflow(parameterized, { batch: "B" }, browser, opts);
  assert.equal(
    (await browser.command(["eval", "document.querySelector('input').value"]))
      .result,
    "B",
  );
  await runWorkflow(recorded, {}, browser, opts);
  assert.equal(
    (await browser.command(["eval", "document.body.dataset.clicked"])).result,
    "menu",
  );
  observation = await browser.observe();
  const scoped = await browser.prepareIndexed(
    observation.observationId,
    element("导出", "区域乙").index,
  );
  await browser.command(["click", scoped.selector]);
  await browser.command(["open", url]);
  await browser.command(["click", scoped.locator]);
  assert.equal(
    (await browser.command(["eval", "document.body.dataset.clicked"])).result,
    "b",
  );
  observation = await browser.observe();
  await assert.rejects(
    browser.prepareIndexed(observation.observationId, element("同名").index),
    /唯一/,
  );
  observation = await browser.observe();
  const stale = element("重绘按钮").index;
  await browser.command([
    "eval",
    `document.querySelector('#change').innerHTML='<button>重绘按钮</button>'`,
  ]);
  await assert.rejects(
    browser.prepareIndexed(observation.observationId, stale),
    /变化/,
  );
  observation = await browser.observe();
  const oldId = observation.observationId;
  await browser.observe();
  await assert.rejects(browser.prepareIndexed(oldId, 1), /失效/);
  observation = await browser.observe();
  const same = observation.elements.filter((e: any) => e.name === "相同操作");
  const specific = await browser.prepareIndexed(
    observation.observationId,
    same[1].index,
  );
  await browser.command([
    "eval",
    `document.querySelector('[data-testid="remove"]').remove()`,
  ]);
  await assert.rejects(browser.command(["click", specific.locator]), /匹配 0/);
  // A new duplicate is never silently replayed against the first element.
  await browser.command([
    "eval",
    `document.querySelector('[role=tab]').insertAdjacentHTML('afterend','<div role="tab">菜单</div>')`,
  ]);
  await assert.rejects(
    browser.command([
      "click",
      recorded.steps[0].type === "click" ? recorded.steps[0].selector : "",
    ]),
    /匹配 2/,
  );
  console.log(
    "PASS indexed real browser: nested Chinese tab, labels, region disambiguation, hidden/disabled filtering, consumed/stale generations, detached nodes, durable reload, parameterized model-free replay, ambiguity blocked",
  );
} finally {
  await browser.command(["close"]).catch(() => {});
  site.close();
  await rm(dir, { recursive: true, force: true });
}
