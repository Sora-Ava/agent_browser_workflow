import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "../server/conversation.ts";
import type { Workflow } from "../shared/workflow.ts";

test("conversation accumulates steps and parameter bindings across turns", () => {
  const chat = new Conversation();
  chat.begin("http://example.local");
  chat.record({ type: "fill", selector: "#name", value: "产品 A" });
  chat.complete("输入产品名称", "已填写", {
    name: "查询",
    startUrl: "http://example.local",
    parameters: [{ name: "product", label: "产品", defaultValue: "产品 A" }],
    steps: [
      { type: "fill", selector: "#name", value: { parameter: "product" } },
    ],
  });
  chat.record({ type: "click", selector: "#query" });
  chat.complete("点击查询", "查询完成", null);
  const state = chat.state();
  assert.equal(state.messages.length, 4);
  assert.equal(state.steps.length, 2);
  assert.deepEqual(state.draft?.steps[0], {
    type: "fill",
    selector: "#name",
    value: { parameter: "product" },
  });
  assert.equal(state.draft?.steps[1].type, "click");
  chat.reset();
  assert.equal(chat.state().steps.length, 0);
});
test("parameter aggregation stays within limits and long colliding names remain valid", () => {
  const chat = new Conversation();
  chat.begin("http://example.local");
  const make = (start: number, count: number): Workflow => ({
    name: "many",
    startUrl: "http://example.local",
    parameters: Array.from({ length: count }, (_, i) => ({
      name: "p" + (start + i),
      label: "field",
      defaultValue: String(start + i),
    })),
    steps: Array.from({ length: start + count }, (_, i) => ({
      type: "fill",
      selector: "#field" + i,
      value: i < start ? String(i) : { parameter: "p" + i },
    })),
  });
  for (let i = 0; i < 20; i++)
    chat.record({ type: "fill", selector: "#field" + i, value: String(i) });
  chat.complete("first", "done", make(0, 20));
  for (let i = 20; i < 40; i++)
    chat.record({ type: "fill", selector: "#field" + i, value: String(i) });
  chat.complete("second", "done", make(20, 20));
  assert.equal(chat.state().draft?.parameters.length, 30);
  assert.deepEqual(chat.state().draft?.steps[39], {
    type: "fill",
    selector: "#field39",
    value: "39",
  });
  const named = new Conversation();
  named.begin("http://example.local");
  const key = "p".repeat(51);
  named.record({ type: "fill", selector: "#one", value: "A" });
  named.complete("one", "done", {
    name: "names",
    startUrl: "http://example.local",
    parameters: [{ name: key, label: "one", defaultValue: "A" }],
    steps: [{ type: "fill", selector: "#one", value: { parameter: key } }],
  });
  named.record({ type: "fill", selector: "#two", value: "B" });
  named.complete("two", "done", {
    name: "names",
    startUrl: "http://example.local",
    parameters: [{ name: key, label: "two", defaultValue: "B" }],
    steps: [
      { type: "fill", selector: "#one", value: "A" },
      { type: "fill", selector: "#two", value: { parameter: key } },
    ],
  });
  assert.equal(named.state().draft?.parameters.length, 2);
  assert.ok(named.state().draft!.parameters.every((p) => p.name.length <= 51));
});
