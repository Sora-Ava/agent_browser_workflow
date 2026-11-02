import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { listenLocal } from "./support/listen.ts";
test("edited workflow saves an independent version and rejects broken bindings without touching original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-edit-"));
  const app = createApp(dir);
  await listenLocal(app.server);
  try {
    const original = app.store.save({
      name: "查询",
      startUrl: "https://example.local",
      parameters: [],
      steps: [{ type: "fill", selector: "#batch", value: "A" }],
    });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}/api/workflows/${original.id}`;
    const edited = {
      ...app.store.get(original.id),
      parameters: [{ name: "batch", label: "批次", defaultValue: "B" }],
      steps: [
        { type: "fill", selector: "#batch", value: { parameter: "batch" } },
      ],
    };
    let response = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edited),
    });
    assert.equal(response.status, 200);
    const saved = (await response.json()) as any;
    assert.equal(saved.version, 2);
    assert.notEqual(saved.id, original.id);
    assert.equal((app.store.get(original.id).steps[0] as any).value, "A");
    response = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...edited, parameters: [] }),
    });
    assert.equal(response.status, 400);
    assert.equal(app.store.list().length, 2);
  } finally {
    app.server.close();
    app.store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
