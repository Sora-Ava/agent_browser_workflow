import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";

test("API rejects foreign origins and invalid runs, and never returns API keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-api-"));
  const app = createApp(dir);
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
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
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
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
