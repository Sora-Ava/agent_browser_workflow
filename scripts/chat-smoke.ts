import { listenLocal } from "../tests/support/listen.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { Browser } from "../server/browser.ts";

const dir = await mkdtemp(join(tmpdir(), "abw-chat-real-"));
const app = createApp(dir, `abw-chat-${Date.now()}`);
const ui = new Browser(join(dir, "ui"), `abw-chat-ui-${Date.now()}`);
const site = createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><meta charset="utf-8"><h1>逐步查询测试</h1><input id="product" placeholder="产品名称"><button id="query" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#product\').value;document.querySelector(\'#ready\').hidden=false;document.querySelector(\'#status\').textContent=\'已查询\'">查询</button><p id="status">尚未查询</p><div id="ready" hidden><p id="result"></p></div>',
  );
});
const transcript: any[] = [
  ["act", { step: { type: "fill", selector: "#product", value: "产品 A" } }],
  [
    "finish",
    {
      name: "逐步查询",
      summary: "已填写产品名称，等待你的下一条指令。",
      parameters: [
        {
          name: "product",
          label: "产品名称",
          defaultValue: "产品 A",
          stepIndexes: [0],
        },
      ],
    },
  ],
  ["act", { step: { type: "click", selector: "#query" } }],
  ["act", { step: { type: "wait", selector: "#ready" } }],
  ["act", { step: { type: "extract", selector: "#result" } }],
  [
    "finish",
    {
      name: "逐步查询",
      summary: "已查询完成，可以保存本次完整流程。",
      parameters: [],
    },
  ],
];
const model = createServer(async (req, res) => {
  for await (const _chunk of req) {
  }
  const [name, args] = transcript.shift();
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "c" + transcript.length,
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
await Promise.all([
  listenLocal(site),
  listenLocal(model),
  listenLocal(app.server),
]);
const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
const target = `http://127.0.0.1:${(site.address() as any).port}`;
async function state() {
  return (await (await fetch(base + "/api/state")).json()) as any;
}
async function until(
  check: () => Promise<boolean>,
  label: string,
  timeout = 30000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(label);
}
async function click(name: string) {
  const selectors: Record<string, string> = {
    启动浏览器: ".workspace-actions > button:first-child",
    发送指令: "button.run-button",
    保存完整流程: ".draft-panel button.primary",
    取消: ".delete-dialog button.secondary",
    删除全部版本: ".delete-dialog button.delete-confirm",
  };
  await ui.command([
    "click",
    selectors[name] || ".flow-delete[aria-label=" + JSON.stringify(name) + "]",
  ]);
}
async function waitMessage(text: string) {
  await until(async () => {
    const value = await ui.command([
      "eval",
      'Boolean(document.querySelector(".chat-transcript")?.textContent.includes(' +
        JSON.stringify(text) +
        "))",
    ]);
    return value.result === true;
  }, "conversation message did not render: " + text);
}
try {
  await app.config.update({
    baseUrl: `http://127.0.0.1:${(model.address() as any).port}/v1`,
    model: "scripted-chat-contract",
    apiKey: "",
    downloadDir: join(dir, "downloads"),
  });
  await ui.command(["open", base]);
  await ui.command(["set", "viewport", "1440", "1100"]);
  assert.equal((await state()).browser.status, "stopped");
  await ui.command(["wait", "--text", "启动浏览器"]);
  await ui.command(["screenshot", resolve("data/ui-chat-start.png")]);
  console.log("PASS workbench loads with automation browser stopped");
  await ui.command([
    "fill",
    'input[placeholder="留空打开浏览器，再用对话指挥"]',
    target,
  ]);
  await click("启动浏览器");
  await until(
    async () => {
      const s = await state();
      if (s.browser.status === "error") throw new Error(s.browser.error);
      return s.browser.status === "ready";
    },
    "browser did not start",
    120000,
  );
  console.log("PASS manual start button opens automation browser");
  await ui.command(["fill", "textarea", "填写产品 A，先不要查询"]);
  await click("发送指令");
  await until(async () => {
    const s = await state();
    return s.active?.status === "succeeded";
  }, "first turn failed");
  assert.equal(
    (await app.browser.command(["get", "text", "#status"])).text,
    "尚未查询",
  );
  assert.equal(
    (await app.browser.command(["get", "value", "#product"])).value,
    "产品 A",
  );
  const firstId = (await state()).active.id;
  console.log("PASS first instruction only fills product without querying");
  await waitMessage("已填写产品名称");
  await ui.command(["fill", "textarea", "现在点击查询并读取结果"]);
  await click("发送指令");
  await until(async () => {
    const s = await state();
    return s.active?.id !== firstId && s.active.status === "succeeded";
  }, "second turn failed");
  const chat = (await state()).conversation;
  assert.equal(chat.messages.length, 4);
  assert.equal(chat.steps.length, 4);
  assert.deepEqual(chat.draft.steps[0].value, { parameter: "product" });
  assert.equal(
    (await app.browser.command(["get", "text", "#result"])).text,
    "产品 A",
  );
  await waitMessage("已查询完成");
  await ui.command(["screenshot", resolve("data/ui-chat-turns.png")]);
  await ui.command(["scrollintoview", ".draft-panel button.primary"]);
  await click("保存完整流程");
  await until(async () => app.store.list().length === 1, "flow save failed");
  const first = app.store.list()[0];
  app.store.saveVersion(first.id, app.store.get(first.id));
  await ui.command(["find", "role", "button", "click", "--name", "我的流程"]);
  await until(
    async () =>
      (
        await ui.command([
          "eval",
          'Boolean(Array.from(document.querySelectorAll(".version-badge")).some(e=>e.textContent.includes("2")))',
        ])
      ).result === true,
    "version list did not refresh",
  );
  await click("删除 逐步查询 版本 1");
  await ui.command(["screenshot", resolve("data/ui-chat-delete.png")]);
  await click("取消");
  assert.equal(app.store.list().length, 2);
  await click("删除 逐步查询 版本 1");
  await ui.command(["check", ".delete-dialog input[type=checkbox]"]);
  await click("删除全部版本");
  await until(async () => app.store.list().length === 0, "flow delete failed");
  assert.equal(app.store.runs().length, 2);
  assert.deepEqual((await ui.command(["errors"])).errors, []);
  console.log(
    "PASS manual startup, two UI instructions without early query/navigation, cumulative parameterized recording, deletion confirmation/cancel/all versions, history preserved",
  );
} catch (e) {
  try {
    console.error(
      "UI diagnostics:",
      (
        await ui.command([
          "eval",
          'JSON.stringify({url:location.href,messages:Array.from(document.querySelectorAll(".chat-message")).map(e=>e.textContent),errors:Array.from(document.querySelectorAll(".banner.error")).map(e=>e.textContent)})',
        ])
      ).result,
    );
  } catch {}
  console.error("Chat smoke failure:", String(e));
  const s = await state();
  console.error(JSON.stringify({ browser: s.browser, active: s.active }));
  throw e;
} finally {
  app.live.close();
  await ui.command(["close"]).catch(() => {});
  await app.browser.command(["close"]).catch(() => {});
  await Promise.all([
    new Promise<void>((r) => app.server.close(() => r())),
    new Promise<void>((r) => site.close(() => r())),
    new Promise<void>((r) => model.close(() => r())),
  ]);
  app.store.db.close();
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
