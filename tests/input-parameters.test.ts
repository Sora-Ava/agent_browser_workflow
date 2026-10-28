import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "../server/conversation.ts";
import { inputRows, toggleInputParameter } from "../shared/input-parameters.ts";

test("executed inputs become reviewable parameters without a model proposal and can be fixed or enabled", () => {
  const chat = new Conversation();
  chat.begin("https://example.local");
  chat.record({
    type: "fill",
    selector: 'text:{"text":"追溯批次"}',
    value: "B001",
  });
  chat.record({ type: "select", selector: "#direction", value: "forward" });
  chat.record({
    type: "fill",
    selector: "#password",
    value: { credential: "password" },
  });
  chat.complete("查询", "完成", null);
  const draft = chat.state().draft!;
  assert.equal(draft.parameters.length, 2);
  assert.equal(draft.parameters[0].label, "追溯批次");
  assert.equal(inputRows(draft).length, 2);
  const fixed = toggleInputParameter(draft, inputRows(draft)[0], false);
  assert.equal((fixed.steps[0] as any).value, "B001");
  assert.equal(fixed.parameters.length, 1);
  const enabled = toggleInputParameter(fixed, inputRows(fixed)[0], true);
  assert.deepEqual((enabled.steps[2] as any).value, { credential: "password" });
  assert.equal(enabled.parameters.length, 2);
});
