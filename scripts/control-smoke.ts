import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { Browser } from "../server/browser.ts";

const dir = await mkdtemp(join(tmpdir(), "abw-control-real-"));
const site = createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><h1 id="counter">0</h1><button id="new-query" onclick="document.querySelector('#result').hidden=false;document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">查询</button><p id="result" hidden>查询完成</p><script>let n=0;setInterval(()=>document.querySelector('#counter').textContent=String(++n),150);setTimeout(()=>{const e=document.createElement('p');e.id='manual-ready';e.textContent='准备完成';document.body.append(e)},4000)</script>`,
  );
});
await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
const target = `http://127.0.0.1:${(site.address() as any).port}`;
const app = createApp(dir, `abw-control-${Date.now()}`);
const ui = new Browser(join(dir, "ui"), `abw-ui-control-${Date.now()}`);
await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
async function api(path: string, body?: unknown) {
  const response = await fetch(
    base + "/api/" + path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = (await response.json()) as any;
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function until(
  check: () => Promise<boolean>,
  message: string,
  timeout = 20000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(message);
}
const streamAbort = new AbortController();
let frames = 0;
let streamRead: Promise<void> | undefined;
let model: ReturnType<typeof createServer> | undefined;
try {
  await app.config.update({
    baseUrl: "http://127.0.0.1:1/v1",
    model: "disabled",
    apiKey: "",
    downloadDir: join(dir, "downloads"),
  });
  await app.browser.command(["open", target]);
  await app.live.start();
  const response = await fetch(base + "/api/live", {
    signal: streamAbort.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  streamRead = (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (event.startsWith("event: frame")) {
            const packet = JSON.parse(event.split("\ndata: ")[1]);
            assert.ok(packet.data.startsWith("/9j/"));
            frames++;
          }
        }
      }
    } catch (e) {
      if (!streamAbort.signal.aborted) throw e;
    }
  })();
  await until(
    async () => frames >= 3,
    "live stream did not produce changing frames",
  );
  assert.equal((await api("state")).active, null);
  console.log(
    "PASS continuous JPEG frames while no workflow steps are executing",
  );
  let entered = false;
  const raw = app.browser.command.bind(app.browser);
  app.browser.command = async (args) => {
    if (args[0] === "wait" && args[1] === "#manual-ready") entered = true;
    return raw(args);
  };
  const original = await api("workflows", {
    name: "暂停测试",
    startUrl: target,
    parameters: [],
    steps: [
      { type: "wait", selector: "#manual-ready" },
      { type: "click", selector: "#new-query" },
      { type: "wait", selector: "#result" },
    ],
  });
  await api("replay", { id: original.id, values: {} });
  await until(async () => entered, "wait step was not entered");
  await api("pause", {});
  await until(
    async () => (await api("state")).active.status === "paused",
    "run did not pause",
  );
  const pausedFrames = frames;
  await until(
    async () => frames > pausedFrames + 1,
    "live stream stopped while paused",
  );
  assert.equal((await api("state")).active.events.length, 1);
  await ui.command(["open", base]);
  await ui.command(["set", "viewport", "1440", "1000"]);
  await ui.command(["wait", "--text", "已暂停"]);
  await ui.command(["wait", "--text", "实时画面"]);
  await ui.command(["screenshot", resolve("data/ui-v2-paused.png")]);
  assert.deepEqual((await ui.command(["errors"])).errors, []);
  await api("resume", {});
  await until(
    async () => (await api("state")).active.status === "succeeded",
    "resume did not complete",
  );
  assert.equal((await api("state")).active.modelCalls, 0);
  console.log(
    "PASS pause at command boundary, live frames during pause, and resume with 0 model calls",
  );
  model = createServer(async (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "patch_locator",
                    arguments: '{"selector":"#new-query"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => model!.listen(0, "127.0.0.1", r));
  await app.config.update({
    baseUrl: `http://127.0.0.1:${(model.address() as any).port}/v1`,
    model: "scripted-repair-contract",
    apiKey: "",
    downloadDir: join(dir, "downloads"),
  });
  const old = await api("workflows", {
    name: "修复测试",
    startUrl: target,
    parameters: [],
    steps: [
      { type: "click", selector: "#old-query" },
      { type: "wait", selector: "#result" },
    ],
  });
  await api("replay", { id: old.id, values: {} });
  await until(
    async () =>
      !["running", "repairing"].includes((await api("state")).active.status),
    "repair did not terminate",
  );
  const repaired = (await api("state")).active;
  assert.equal(repaired.status, "succeeded", repaired.error);
  assert.equal(repaired.modelCalls, 1);
  assert.equal(repaired.repairedVersion, 2);
  assert.deepEqual(app.store.get(old.id).steps[0], {
    type: "click",
    selector: "#old-query",
  });
  await app.config.update({
    baseUrl: "http://127.0.0.1:1/v1",
    model: "disabled",
    apiKey: "",
    downloadDir: join(dir, "downloads"),
  });
  await api("replay", { id: repaired.repairedVersionId, values: {} });
  await until(
    async () => (await api("state")).active.status === "succeeded",
    "new version did not replay",
  );
  assert.equal((await api("state")).active.modelCalls, 0);
  console.log(
    "PASS scripted model repairs missing locator, saves version 2, and next real replay uses 0 model calls",
  );
  await ui.command(["find", "role", "button", "click", "--name", "我的流程"]);
  await ui.command(["wait", "--text", "版本 2"]);
  await ui.command(["click", ".flow-row:first-child"]);
  await ui.command(["screenshot", resolve("data/ui-v2-version.png")]);
} finally {
  streamAbort.abort();
  await streamRead;
  app.live.close();
  await ui.command(["close"]).catch(() => {});
  await app.browser.command(["close"]).catch(() => {});
  await new Promise<void>((r) => app.server.close(() => r()));
  await new Promise<void>((r) => site.close(() => r()));
  if (model) await new Promise<void>((r) => model!.close(() => r()));
  app.store.db.close();
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
