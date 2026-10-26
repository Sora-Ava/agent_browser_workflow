import { listenLocal } from "./support/listen.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { createServer } from "node:http";

test("API rejects foreign origins and invalid runs, and never returns API keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-api-"));
  const app = createApp(dir);
  await listenLocal(app.server);
  const address = app.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const denied = await fetch(base + "/api/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: "https://foreign.example",
      },
      body: "{}",
    });
    assert.equal(denied.status, 403);
    const saved = await fetch(base + "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:9000/v1",
        model: "test",
        apiKey: "super-private",
        downloadDir: dir,
      }),
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (await (await fetch(base + "/api/settings")).text()).includes(
        "super-private",
      ),
      false,
    );
    const invalid = await fetch(base + "/api/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>((r) => app.server.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("pause waits for current command, blocks another run, and cancel releases paused task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-pause-"));
  const app = createApp(dir);
  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  let entered = false,
    presses = 0;
  app.browser.command = async (args) => {
    if (args[0] === "press") {
      presses++;
      entered = true;
      if (presses === 1) await pending;
    }
    return {};
  };
  app.browser.screenshot = async () => Buffer.from("frame");
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const request = (path: string, input?: unknown) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input || {}),
    });
  const state = async () =>
    ((await (await fetch(base + "/api/state")).json()) as any).active;
  try {
    await request("browser/start", { url: "http://example.local" });
    const saved = app.store.save({
      name: "pause",
      startUrl: "http://example.local",
      parameters: [],
      steps: [
        { type: "press", key: "Tab" },
        { type: "press", key: "Enter" },
      ],
    });
    const input = { id: saved.id, values: {} };
    assert.equal((await request("replay", input)).status, 202);
    for (let i = 0; i < 30 && !entered; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal((await request("pause")).status, 200);
    assert.equal((await state()).status, "pausing");
    release();
    for (let i = 0; i < 30 && (await state()).status !== "paused"; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal((await state()).status, "paused");
    assert.equal(presses, 1);
    assert.equal((await request("replay", input)).status, 409);
    assert.equal(
      (await fetch(base + "/api/workflows/" + saved.id, { method: "DELETE" }))
        .status,
      409,
    );
    await request("cancel");
    for (let i = 0; i < 30 && (await state()).status !== "cancelled"; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal((await state()).status, "cancelled");
    assert.equal(presses, 1);
  } finally {
    release();
    app.live.close();
    await new Promise<void>((r) => app.server.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("successful locator repair persists a new version while original remains immutable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-repair-api-"));
  const app = createApp(dir);
  app.browser.command = async (args) =>
    args[0] === "get" ? { count: args[2] === "#old" ? 0 : 1 } : {};
  app.browser.screenshot = async () => Buffer.from("frame");
  app.browser.observe = async () => ({
    snapshot: "button Query",
    targets: '[{"selector":"#new"}]',
  });
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const input = JSON.parse(raw);
    assert.ok(!input.messages[1].content.includes("secret-value"));
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
                    arguments: '{"selector":"#new"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await listenLocal(model);
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    await app.config.update({
      baseUrl: `http://127.0.0.1:${(model.address() as any).port}/v1`,
      apiKey: "",
      model: "contract-model",
      downloadDir: dir,
    });
    await fetch(base + "/api/browser/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const original = app.store.save({
      name: "repair",
      startUrl: "http://example.local",
      parameters: [],
      steps: [{ type: "fill", selector: "#old", value: "secret-value" }],
    });
    const response = await fetch(base + "/api/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: original.id, values: {} }),
    });
    assert.equal(response.status, 202);
    let active: any;
    for (let i = 0; i < 60; i++) {
      active = ((await (await fetch(base + "/api/state")).json()) as any)
        .active;
      if (!["running", "repairing"].includes(active.status)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(active.status, "succeeded", active.error);
    assert.equal(active.modelCalls, 1);
    assert.equal(active.repairedVersion, 2);
    assert.deepEqual(app.store.get(original.id).steps, [
      { type: "fill", selector: "#old", value: "secret-value" },
    ]);
    assert.deepEqual(app.store.get(active.repairedVersionId).steps, [
      { type: "fill", selector: "#new", value: "secret-value" },
    ]);
    let captures = 0;
    let release: () => void = () => {};
    const pending = new Promise<void>((r) => (release = r));
    app.browser.screenshot = async () => {
      if (++captures === 2) await pending;
      return Buffer.from("frame");
    };
    await fetch(base + "/api/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: original.id, values: {} }),
    });
    for (let i = 0; i < 80 && captures < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    await fetch(base + "/api/cancel", { method: "POST" });
    release();
    for (let i = 0; i < 80; i++) {
      active = ((await (await fetch(base + "/api/state")).json()) as any)
        .active;
      if (active.status === "cancelled") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(active.status, "cancelled");
    assert.equal(
      app.store.list().length,
      2,
      "cancelled repair must not save another version",
    );
  } finally {
    app.live.close();
    await new Promise<void>((r) => app.server.close(() => r()));
    await new Promise<void>((r) => model.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("run stays busy until final screenshot completes so terminal status permits immediate replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-lock-"));
  const app = createApp(dir);
  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  let captures = 0;
  app.browser.command = async () => ({});
  app.browser.screenshot = async () => {
    if (++captures === 2) await pending;
    return Buffer.from("frame");
  };
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    await fetch(base + "/api/browser/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    captures = 0;
    const saved = app.store.save({
      name: "test",
      startUrl: "http://example.local",
      parameters: [],
      steps: [{ type: "press", key: "Enter" }],
    });
    const post = () =>
      fetch(base + "/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: saved.id, values: {} }),
      });
    assert.equal((await post()).status, 202);
    for (let i = 0; i < 40 && captures < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(captures, 2);
    assert.equal(
      ((await (await fetch(base + "/api/state")).json()) as any).active.status,
      "running",
    );
    release();
    for (let i = 0; i < 40; i++) {
      const s = (await (await fetch(base + "/api/state")).json()) as any;
      if (s.active.status !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((await post()).status, 202);
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    release();
    await new Promise<void>((r) => app.server.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
