import { listenLocal } from "./support/listen.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";

test("startup and status do not touch browser; instructions require explicit startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-start-"));
  const app = createApp(dir);
  let calls = 0;
  app.browser.command = async () => {
    calls++;
    return {};
  };
  app.browser.screenshot = async () => Buffer.from("frame");
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const post = (path: string, body: unknown = {}) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const state = (await (await fetch(base + "/api/state")).json()) as any;
    assert.equal(state.browser.status, "stopped");
    assert.equal(calls, 0);
    const subscription = new AbortController();
    const stream = await fetch(base + "/api/live", {
      signal: subscription.signal,
    });
    assert.equal(calls, 0);
    await stream.body!.cancel();
    subscription.abort();
    assert.equal((await post("chat", { instruction: "点击查询" })).status, 409);
    assert.equal(calls, 0);
    assert.equal(
      (await post("browser/start", { url: "about:blank" })).status,
      200,
    );
    assert.ok(calls > 0);
    assert.equal(
      ((await (await fetch(base + "/api/state")).json()) as any).browser.status,
      "ready",
    );
    await post("conversation/reset");
    assert.equal(
      ((await (await fetch(base + "/api/state")).json()) as any).conversation
        .messages.length,
      0,
    );
  } finally {
    app.live.close();
    await new Promise<void>((r) => app.server.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("browser is not ready until startup capture finishes and concurrent requests are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-start-lock-"));
  const app = createApp(dir);
  let captureEntered = false;
  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  app.browser.command = async () => ({});
  app.browser.screenshot = async () => {
    captureEntered = true;
    await pending;
    return Buffer.from("frame");
  };
  await listenLocal(app.server);
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const post = (path: string, body: unknown = {}) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const starting = post("browser/start");
  try {
    for (let i = 0; i < 50 && !captureEntered; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(
      ((await (await fetch(base + "/api/state")).json()) as any).browser.status,
      "starting",
    );
    assert.equal((await post("browser/start")).status, 409);
    assert.equal((await post("chat", { instruction: "hello" })).status, 409);
    release();
    assert.equal((await starting).status, 200);
  } finally {
    release();
    await starting;
    app.live.close();
    await new Promise<void>((r) => app.server.close(() => r()));
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
