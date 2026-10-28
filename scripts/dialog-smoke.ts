import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser } from "../server/browser.ts";
import { listenLocal } from "../tests/support/listen.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-dialog-"));
const browser = new Browser(dir, `abw-dialog-${Date.now()}`);
const site = createServer((_, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><body>${Array.from({ length: 180 }, (_, i) => `<button style="display:block;height:40px">背景${i}</button>`).join("")}
<div class="el-dialog" style="position:fixed;z-index:2000;top:20px;left:20px;background:white;width:400px;height:260px"><span class="el-dialog__title">批次选择</span><button onclick="document.body.dataset.clicked='dialog'">弹窗确认</button></div>
<div class="el-select-dropdown" style="position:fixed;z-index:3000;top:300px;left:20px;background:white"><div role="option" onclick="document.body.dataset.clicked='option'">正向追溯</div></div></body>`);
});
await listenLocal(site);
try {
  await browser.command([
    "open",
    `http://127.0.0.1:${(site.address() as any).port}`,
  ]);
  const observation = await browser.observe();
  assert.ok(
    observation.elements.some((e: any) => e.name === "弹窗确认"),
    "dialog must survive background >160 truncation",
  );
  assert.ok(
    observation.elements.some((e: any) => e.name === "正向追溯"),
    "portal option must remain actionable",
  );
  assert.equal(
    observation.elements.some((e: any) => e.name.startsWith("背景")),
    false,
  );
  assert.equal(observation.surface.name, "批次选择");
  const target = observation.elements.find((e: any) => e.name === "弹窗确认");
  const prepared = await browser.prepareIndexed(
    observation.observationId,
    target.index,
  );
  await browser.command(["click", prepared.selector]);
  assert.equal(
    (await browser.command(["eval", "document.body.dataset.clicked"])).result,
    "dialog",
  );
  await browser.command(["click", prepared.locator]);
  assert.equal(
    (await browser.command(["eval", "document.body.dataset.clicked"])).result,
    "dialog",
  );
  await browser.command([
    "eval",
    `Object.assign(document.querySelector('.el-select-dropdown').style,{top:'100px',left:'30px',width:'380px',height:'150px'})`,
  ]);
  const overlaid = await browser.observe();
  assert.equal(
    overlaid.surface.type,
    "dialog",
    "portal covering dialog center must not erase active dialog",
  );
  assert.ok(overlaid.elements.some((e: any) => e.name === "正向追溯"));
  assert.equal(
    overlaid.elements.some((e: any) => e.name.startsWith("背景")),
    false,
  );
  console.log(
    "PASS custom dialog beyond 180 background controls, modal title/context, portal dropdown, indexed click and durable replay",
  );
} finally {
  await browser.command(["close"]).catch(() => {});
  site.close();
  await rm(dir, { recursive: true, force: true });
}
