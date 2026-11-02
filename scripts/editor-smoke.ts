import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../server/app.ts";
import { Browser } from "../server/browser.ts";
import { listenLocal } from "../tests/support/listen.ts";
const dir = await mkdtemp(join(tmpdir(), "abw-editor-ui-"));
const app = createApp(dir);
const ui = new Browser(join(dir, "ui"), `abw-editor-${Date.now()}`);
const original = app.store.save({
  name: "批次查询",
  startUrl: "https://example.local",
  parameters: [{ name: "batch", label: "批次", defaultValue: "A" }],
  steps: [{ type: "fill", selector: "#batch", value: { parameter: "batch" } }],
});
await listenLocal(app.server);
const text = (s: string) =>
  "text:" + JSON.stringify({ text: s, match: "exact" });
try {
  await ui.command([
    "open",
    `http://127.0.0.1:${(app.server.address() as any).port}`,
  ]);
  await ui.command(["wait", ".flow-short"]);
  await ui.command(["click", ".flow-short"]);
  await ui.command([
    "eval",
    `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('查看保存'))?.click()`,
  ]);
  await ui.command(["click", text("编辑步骤与参数")]);
  await ui.command(["fill", text("默认值"), "B"]);
  await ui.command(["select", '[aria-label="步骤 1 输入来源"]', "fixed"]);
  await ui.command(["fill", text("固定值"), "固定输入"]);
  await ui.command(["select", '[aria-label="步骤 1 输入来源"]', "parameter"]);
  await ui.command(["screenshot", resolve("data/ui-workflow-editor.png")]);
  await ui.command(["click", text("保存为新版本")]);
  for (let i = 0; i < 100 && app.store.list().length < 2; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(app.store.list().length, 2);
  const saved = app.store.list().find((w) => w.id !== original.id)!;
  assert.equal(saved.parameters[0].defaultValue, "B");
  assert.deepEqual(saved.steps[0].value, { parameter: "batch" });
  assert.equal(app.store.get(original.id).parameters[0].defaultValue, "A");
  console.log(
    "PASS editor UI while browser stopped: fixed/parameter binding, default editing, independent version save, original preserved, no model calls",
  );
} finally {
  await ui.command(["close"]).catch(() => {});
  app.server.close();
  app.store.db.close();
  await rm(dir, { recursive: true, force: true });
}
