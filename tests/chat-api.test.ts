import { listenLocal } from "./support/listen.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";

test("two instructions continue the page, preserve history and save cumulative recording", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-chat-"));
  const app = createApp(dir);
  const commands: string[][] = [];
  app.browser.command = async (args) => {
    commands.push(args);
    return args[0] === "get" ? { url: "http://example.local", count: 1 } : {};
  };
  app.browser.observe = async () => ({
    snapshot: "Product query",
    targets: "[]",
  });
  app.browser.screenshot = async () => Buffer.from("frame");
  const requests: any[] = [];
  const transcript: any[] = [
    ["act", { step: { type: "fill", selector: "#product", value: "产品 A" } }],
    [
      "finish",
      {
        name: "查询",
        summary: "已填写，等待下一条指令。",
        parameters: [
          {
            name: "product",
            label: "产品",
            defaultValue: "产品 A",
            stepIndexes: [0],
          },
        ],
      },
    ],
    ["act", { step: { type: "click", selector: "#query" } }],
    ["finish", { name: "查询", summary: "已点击查询。", parameters: [] }],
  ];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    const item = transcript.shift();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: item
              ? {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call-" + requests.length,
                      type: "function",
                      function: {
                        name: item[0],
                        arguments: JSON.stringify(item[1]),
                      },
                    },
                  ],
                }
              : {
                  role: "assistant",
                  content: "请先手动完成验证码，再告诉我。",
                },
          },
        ],
      }),
    );
  });
  await listenLocal(provider);
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const state = async () =>
    (await (await fetch(base + "/api/state")).json()) as any;
  async function turn(instruction: string) {
    assert.equal((await post("chat", { instruction })).status, 202);
    for (let i = 0; i < 100; i++) {
      const s = await state();
      if (
        !["running", "pausing", "paused", "repairing"].includes(s.active.status)
      )
        return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("chat timeout");
  }
  try {
    await app.config.update({
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      model: "scripted",
      apiKey: "",
      downloadDir: dir,
    });
    await post("browser/start", { url: "http://example.local" });
    const first = await turn("填写产品 A，先不要查询");
    assert.equal(first.active.status, "succeeded");
    assert.equal(commands.filter((c) => c[0] === "click").length, 0);
    const second = await turn("现在点击查询");
    assert.equal(second.active.status, "succeeded");
    assert.equal(second.conversation.messages.length, 4);
    assert.deepEqual(second.conversation.draft.steps, [
      { type: "fill", selector: "#product", value: { parameter: "product" } },
      { type: "click", selector: "#query" },
    ]);
    assert.equal(commands.filter((c) => c[0] === "open").length, 1);
    assert.equal(commands.filter((c) => c[0] === "fill").length, 1);
    assert.equal(commands.filter((c) => c[0] === "click").length, 1);
    assert.ok(
      requests[2].messages.some(
        (m: any) => m.role === "user" && m.content.includes("填写产品 A"),
      ),
    );
    const reply = await turn("需要我做什么？");
    assert.equal(reply.active.status, "succeeded");
    assert.equal(reply.conversation.steps.length, 2);
    assert.equal(
      reply.conversation.messages.at(-1).content,
      "请先手动完成验证码，再告诉我。",
    );
    assert.equal(app.store.conversation().messages.length, 6);
    const save = app.store.saveConversation.bind(app.store);
    app.store.saveConversation = (value) => {
      if ((value as any).messages.length >= 8)
        throw new Error("simulated finalization failure");
      save(value);
    };
    const failed = await turn("测试收尾失败");
    assert.equal(failed.active.status, "failed");
    assert.equal((await post("conversation/reset", {})).status, 200);
  } finally {
    app.live.close();
    await new Promise<void>((r) => app.server.close(() => r()));
    await new Promise<void>((r) => provider.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
