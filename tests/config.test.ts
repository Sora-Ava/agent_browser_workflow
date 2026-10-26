import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../server/config.ts";

test("configuration persists secrets but public settings and redaction do not disclose them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-config-"));
  try {
    const config = new Config(dir);
    await config.update({
      baseUrl: "http://localhost:9999/v1",
      model: "local-model",
      apiKey: "private-test-key",
      downloadDir: dir,
    });
    assert.equal((await config.publicSettings()).hasApiKey, true);
    assert.equal(
      JSON.stringify(await config.publicSettings()).includes(
        "private-test-key",
      ),
      false,
    );
    await config.update({
      baseUrl: "http://localhost:9999/v1",
      model: "local-model",
      apiKey: "",
      downloadDir: dir,
    });
    assert.equal((await config.read()).apiKey, "private-test-key");
    const id = await config.saveCredential({
      origin: "http://example.local/login",
      alias: "测试",
      username: "alice",
      password: "test-password",
    });
    assert.equal((await config.credential(id)).origin, "http://example.local");
    assert.equal(
      JSON.stringify(await config.credentials()).includes("test-password"),
      false,
    );
    assert.equal(
      await config.redact("alice test-password private-test-key"),
      "[已隐藏] [已隐藏] [已隐藏]",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("redacting events preserves object keys and numeric fields for short passwords", async () => {
  const dir = await mkdtemp(join(tmpdir(), "abw-redact-"));
  try {
    const config = new Config(dir);
    await config.saveCredential({
      origin: "http://example.local",
      alias: "test",
      username: "step",
      password: "1",
    });
    assert.deepEqual(
      await config.redactValue({
        index: 1,
        step: { type: "fill", output: "step 1" },
      }),
      { index: 1, step: { type: "fill", output: "[已隐藏] [已隐藏]" } },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
