import { test } from "node:test";
import assert from "node:assert/strict";
import { renameParameter } from "../shared/workflow-edit.ts";
import { workflowSchema } from "../shared/workflow.ts";
test("parameter rename updates every binding without mutating original and rejects collisions", () => {
  const w = workflowSchema.parse({
    name: "查询",
    startUrl: "https://example.local",
    parameters: [
      { name: "batch", label: "批次", defaultValue: "A" },
      { name: "other", label: "其他", defaultValue: "B" },
    ],
    steps: [
      { type: "fill", selector: "#batch", value: { parameter: "batch" } },
      {
        type: "fill",
        selector: "#password",
        value: { credential: "password" },
      },
    ],
  });
  const changed = renameParameter(w, "batch", "lot");
  assert.deepEqual((changed.steps[0] as any).value, { parameter: "lot" });
  assert.equal(w.parameters[0].name, "batch");
  assert.throws(() => renameParameter(w, "batch", "other"));
});
