import { test } from "node:test";
import assert from "node:assert/strict";
import { parseElementLocator } from "../server/page-elements.ts";

test("durable element descriptors allow sparse stable attributes, never arbitrary keys", () => {
  const d = {
    tag: "INPUT",
    role: "textbox",
    name: "批次",
    text: "",
    attrs: { id: "batch" },
    region: "查询",
  };
  assert.deepEqual(parseElementLocator("element:" + JSON.stringify(d)), d);
  assert.throws(() =>
    parseElementLocator(
      "element:" + JSON.stringify({ ...d, attrs: { onclick: "bad" } }),
    ),
  );
  assert.equal(parseElementLocator("#batch"), null);
});
