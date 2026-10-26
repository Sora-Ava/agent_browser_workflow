import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { DatabaseSync } from "node:sqlite";

test("repaired versions preserve originals and share lineage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-versions-"));
  const store = new Store(dir);
  try {
    const first = store.save({
      name: "test",
      startUrl: "http://example.local",
      parameters: [],
      steps: [{ type: "click", selector: "#old" }],
    });
    const second = store.saveVersion(first.id, {
      ...store.get(first.id),
      steps: [{ type: "click", selector: "#new" }],
    });
    assert.equal(second.version, 2);
    assert.equal(second.rootId, first.id);
    assert.equal(second.parentId, first.id);
    assert.deepEqual(store.get(first.id).steps, [
      { type: "click", selector: "#old" },
    ]);
    assert.equal(store.list().filter((w) => w.rootId === first.id).length, 2);
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("upgrading a pre-version database preserves workflow IDs and contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-migrate-"));
  const old = new DatabaseSync(join(dir, "workflows.sqlite"));
  const workflow = {
    name: "existing",
    startUrl: "http://example.local",
    parameters: [],
    steps: [{ type: "press", key: "Tab" }],
  };
  old.exec(
    "CREATE TABLE workflows(id TEXT PRIMARY KEY,created TEXT,body TEXT)",
  );
  old
    .prepare("INSERT INTO workflows VALUES(?,?,?)")
    .run("old-id", "2026-10-26", JSON.stringify(workflow));
  old.close();
  const store = new Store(dir);
  try {
    assert.equal(store.list()[0].id, "old-id");
    assert.equal(store.list()[0].version, 1);
    assert.deepEqual(store.get("old-id"), workflow);
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
