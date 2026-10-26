import { test } from "node:test";
import assert from "node:assert/strict";
import { RunControl } from "../server/control.ts";

test("pause gates new actions, resume releases them, and stop releases a paused waiter", async () => {
  const states: string[] = [];
  const control = new RunControl((s) => states.push(s));
  control.pause();
  let ran = false;
  const waiting = control.checkpoint().then(() => {
    ran = true;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ran, false);
  assert.equal(control.status, "paused");
  control.resume();
  await waiting;
  assert.equal(ran, true);
  control.pause();
  const stopped = control.checkpoint();
  control.cancel();
  await assert.rejects(stopped);
  assert.ok(states.includes("paused"));
  assert.ok(states.includes("running"));
});
test("pause requested during resume observation still blocks the next command", async () => {
  let release: () => void = () => {};
  const refreshing = new Promise<void>((r) => (release = r));
  let entered = false,
    ran = false;
  const control = new RunControl(
    () => {},
    async () => {
      entered = true;
      await refreshing;
    },
  );
  control.pause();
  const waiting = control.checkpoint().then(() => {
    ran = true;
  });
  try {
    control.resume();
    for (let i = 0; i < 30 && !entered; i++)
      await new Promise((r) => setTimeout(r, 2));
    control.pause();
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ran, false);
    assert.equal(control.status, "paused");
  } finally {
    control.cancel();
    await waiting.catch(() => {});
  }
});
