import { workflowSchema, type Workflow } from "./workflow.ts";
export function renameParameter(
  flow: Workflow,
  oldName: string,
  newName: string,
): Workflow {
  const next = structuredClone(flow);
  next.parameters = next.parameters.map((p) =>
    p.name === oldName ? { ...p, name: newName } : p,
  );
  for (const s of next.steps)
    if (
      "value" in s &&
      typeof s.value === "object" &&
      "parameter" in s.value &&
      s.value.parameter === oldName
    )
      s.value = { parameter: newName };
  return workflowSchema.parse(next);
}
