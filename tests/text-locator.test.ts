import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTextLocator } from "../server/text-locator.ts";

test("semantic text locators persist Chinese intent and reject invalid fields", () => {
  assert.deepEqual(parseTextLocator('text:{"text":"菜单","role":"tab"}'), {
    text: "菜单",
    role: "tab",
    match: "auto",
  });
  assert.equal(parseTextLocator("#menu"), null);
  assert.throws(() => parseTextLocator('text:{"text":""}'));
  assert.throws(() =>
    parseTextLocator('text:{"text":"菜单","javascript":"click()"}'),
  );
});
