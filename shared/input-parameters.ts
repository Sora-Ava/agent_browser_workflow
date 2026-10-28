import { workflowSchema, type Workflow, type Step } from "./workflow.ts";

export interface InputRow {
  indexes: number[];
  label: string;
  value: string;
  parameter?: string;
}
function fieldLabel(step: Step, index: number) {
  if (!("selector" in step)) return `输入 ${index + 1}`;
  try {
    const s = step.selector;
    if (
      !s.startsWith("element:") &&
      !s.startsWith("text:") &&
      /password|passwd|username|captcha|\[type\s*=\s*["']?password/i.test(s)
    )
      return null;
    const d = s.startsWith("element:")
      ? JSON.parse(s.slice(8))
      : s.startsWith("text:")
        ? JSON.parse(s.slice(5))
        : null;
    if (
      d?.attrs?.type === "password" ||
      /^(密码|口令|验证码|用户名|账号|password|username|captcha|api.?key)$/i.test(
        d?.name || d?.text || "",
      )
    )
      return null;
    return String(
      d?.name || d?.text || d?.attrs?.placeholder || `输入 ${index + 1}`,
    ).slice(0, 80);
  } catch {
    return `输入 ${index + 1}`;
  }
}
export function inputRows(flow: Workflow): InputRow[] {
  const rows: InputRow[] = [];
  for (const [i, s] of flow.steps.entries()) {
    if (s.type !== "fill" && s.type !== "select") continue;
    if (typeof s.value === "object" && "credential" in s.value) continue;
    const label = fieldLabel(s, i);
    if (!label) continue;
    const parameter =
      typeof s.value === "object" ? s.value.parameter : undefined;
    const p = flow.parameters.find((p) => p.name === parameter);
    const value = typeof s.value === "string" ? s.value : p?.defaultValue || "";
    const existing = parameter
      ? rows.find((r) => r.parameter === parameter)
      : undefined;
    if (existing) existing.indexes.push(i);
    else
      rows.push({ indexes: [i], label: p?.label || label, value, parameter });
  }
  return rows;
}
export function toggleInputParameter(
  flow: Workflow,
  row: InputRow,
  enabled: boolean,
): Workflow {
  const next = structuredClone(flow);
  if (enabled && row.parameter) return next;
  if (enabled && next.parameters.length >= 30)
    throw new Error("最多可设置30个参数，请先取消不需要变化的输入");
  let name = row.parameter || "input_" + (row.indexes[0] + 1);
  if (enabled) {
    let suffix = 2;
    while (next.parameters.some((p) => p.name === name))
      name = `input_${row.indexes[0] + 1}_${suffix++}`;
    next.parameters.push({ name, label: row.label, defaultValue: row.value });
  }
  for (const index of row.indexes) {
    const step = next.steps[index];
    if (step?.type === "fill" || step?.type === "select")
      step.value = enabled ? { parameter: name } : row.value;
  }
  const used = new Set(
    next.steps.flatMap((s) =>
      "value" in s && typeof s.value === "object" && "parameter" in s.value
        ? [s.value.parameter]
        : [],
    ),
  );
  next.parameters = next.parameters.filter((p) => used.has(p.name));
  return workflowSchema.parse(next);
}
export function inferInputParameters(flow: Workflow): Workflow {
  let next = flow;
  for (const row of inputRows(flow)) {
    if (!row.parameter && row.value && next.parameters.length < 30)
      next = toggleInputParameter(next, row, true);
  }
  return next;
}
