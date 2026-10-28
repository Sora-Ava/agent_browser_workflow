import { test } from "node:test";
import assert from "node:assert/strict";
import { modelMessages } from "../server/model-context.ts";

test("context trimming never truncates system rules or the current user goal", () => {
  const rules = "规则".repeat(2200);
  const goal = "任务".repeat(2500) + "最后必须导出";
  const packed = modelMessages([
    { role: "system", content: rules },
    { role: "user", content: goal },
  ]);
  assert.equal(packed[0].content, rules);
  assert.equal(packed[1].content, goal);
});

test("model context keeps latest observation and complete recent tool groups only", () => {
  const messages: any[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "task" },
  ];
  for (let i = 0; i < 12; i++) {
    messages.push({
      role: "assistant",
      tool_calls: [
        { id: "c" + i, function: { name: "observe", arguments: "{}" } },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: "c" + i,
      content: JSON.stringify({
        observationId: "obs" + i,
        snapshot: "x".repeat(18000),
        elements: [{ index: 1, name: "菜单" }],
      }),
    });
  }
  const packed = modelMessages(messages);
  assert.ok(JSON.stringify(packed).length < 16000);
  assert.match(JSON.stringify(packed), /obs11/);
  assert.equal(JSON.stringify(packed).includes("obs10"), false);
  for (const message of packed.filter((m) => m.role === "tool"))
    assert.ok(
      packed.some((m) =>
        m.tool_calls?.some((t: any) => t.id === message.tool_call_id),
      ),
    );
});
