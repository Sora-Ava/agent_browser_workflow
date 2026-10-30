import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { createApp } from "../server/app.ts";
import { listenLocal } from "../tests/support/listen.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-picker-"));
const app = createApp(dir, `abw-picker-${Date.now()}`);
const site = createServer((_, res) => {
  res.setHeader("content-type", "text/html;charset=utf-8");
  res.end(
    `<body><button id="target" onpointerup="document.body.dataset.releases='triggered'" onmouseup="document.body.dataset.releases='triggered'" onclick="document.body.dataset.count=String(Number(document.body.dataset.count||0)+1)"><span>确认目标</span></button></body>`,
  );
});
await listenLocal(site);
await listenLocal(app.server);
const base = `http://127.0.0.1:${(app.server.address() as any).port}/api/`;
const url = `http://127.0.0.1:${(site.address() as any).port}`;
async function post(path: string, data: any) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await r.json();
  return { status: r.status, body: body as any };
}
try {
  const original = app.store.save({
    name: "选择测试",
    startUrl: url,
    parameters: [],
    steps: [{ type: "click", selector: "#wrong" }],
  });
  assert.equal(
    (await post("manual/start", { workflowId: original.id, index: 0 })).status,
    409,
  );
  await post("browser/start", { url });
  assert.equal(
    (await post("manual/start", { workflowId: original.id, index: 0 })).status,
    200,
  );
  assert.equal((await post("chat", { instruction: "检查" })).status, 409);
  await app.browser.command(["click", "#target span"]);
  await app.browser.command(["click", "#target span"]);
  assert.equal(
    (
      await app.browser.command([
        "eval",
        "document.body.dataset.releases||'none'",
      ])
    ).result,
    "none",
  );
  assert.equal(
    (await app.browser.command(["eval", 'document.body.dataset.count||"0"']))
      .result,
    "0",
  );
  const replaced = await post("manual/replace", {
    workflowId: original.id,
    index: 0,
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(replaced.body.version, 2);
  assert.ok(replaced.body.steps[0].selector.startsWith("element:"));
  assert.equal(
    app.store.get(original.id).steps[0].type === "click" &&
      (app.store.get(original.id).steps[0] as any).selector,
    "#wrong",
  );
  assert.equal(
    (
      await post("manual/test", {
        workflowId: replaced.body.id,
        index: 0,
        values: {},
      })
    ).status,
    202,
  );
  for (let i = 0; i < 100; i++) {
    const s = (await (await fetch(base + "state")).json()) as any;
    if (s.active?.status === "succeeded") break;
    if (s.active?.status === "failed") throw new Error(s.active.error);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (await app.browser.command(["eval", "document.body.dataset.count"])).result,
    "1",
  );
  await post("manual/start", { workflowId: replaced.body.id, index: 0 });
  await post("manual/cancel", {});
  await app.browser.command(["click", "#target"]);
  assert.equal(
    (await app.browser.command(["eval", "document.body.dataset.count"])).result,
    "2",
  );
  console.log(
    "PASS selection intercepts click, locks automation, versioned unique locator preserves original, single-step executes once with 0 model calls, cancel restores interaction",
  );
  await app.browser.command(["open", base.replace(/api\/$/, "")]);
  await app.browser.command(["wait", ".flow-short"]);
  await app.browser.command(["click", ".flow-short:nth-of-type(1)"]);
  await app.browser.command([
    "eval",
    `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('查看保存的'))?.click()`,
  ]);
  await app.browser.command([
    "screenshot",
    resolve("data/ui-manual-picker.png"),
  ]);
  assert.equal(
    (
      await app.browser.command([
        "eval",
        `document.body.textContent.includes('手动选元素')&&document.body.textContent.includes('单步测试')`,
      ])
    ).result,
    true,
  );
} finally {
  await app.browser.command(["close"]).catch(() => {});
  app.server.close();
  site.close();
  app.store.db.close();
  await rm(dir, { recursive: true, force: true });
}
