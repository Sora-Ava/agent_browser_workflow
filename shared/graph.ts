import { z } from "zod";
import type { Workflow } from "./workflow.ts";
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const locator = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine(
    (s) => !s.startsWith("-") && !/@e\d+|data-abw-index/.test(s),
    "不能保存临时元素引用",
  );
const common = {
  id,
  label: z.string().min(1).max(100),
  x: z.number().min(0).max(30000).optional(),
  y: z.number().min(0).max(30000).optional(),
};
export const graphNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("action"),
    stepIndex: z.number().int().nonnegative(),
    next: id,
  }),
  z.object({
    ...common,
    kind: z.literal("condition"),
    test: z.enum(["visible", "textContains"]),
    readySelector: locator,
    selector: locator,
    text: z.string().min(1).max(1000).optional(),
    yes: id,
    no: id,
  }),
  z.object({
    ...common,
    kind: z.literal("end"),
    message: z.string().max(2000),
    status: z.enum(["succeeded", "no_data"]),
  }),
]);
export const graphSchema = z.object({
  entry: id,
  nodes: z.array(graphNodeSchema).min(1).max(150),
});
export type FlowGraph = z.infer<typeof graphSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export const successors = (n: GraphNode) =>
  n.kind === "action" ? [n.next] : n.kind === "condition" ? [n.yes, n.no] : [];
export function graphErrors(g: FlowGraph, stepCount: number): string[] {
  const errors: string[] = [];
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  if (nodes.size !== g.nodes.length) errors.push("节点标识重复");
  if (!nodes.has(g.entry)) errors.push("缺少起始节点");
  for (const n of g.nodes) {
    if (n.kind === "action" && n.stepIndex >= stepCount)
      errors.push(`${n.label} 引用了不存在的步骤`);
    if (n.kind === "condition" && n.test === "textContains" && !n.text?.trim())
      errors.push(`${n.label} 缺少待匹配文字`);
    for (const next of successors(n))
      if (!nodes.has(next)) errors.push(`${n.label} 的出口没有有效目标`);
  }
  const visiting = new Set<string>(),
    seen = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push("不支持循环连接");
      return;
    }
    if (seen.has(id) || !nodes.has(id)) return;
    visiting.add(id);
    seen.add(id);
    for (const next of successors(nodes.get(id)!)) visit(next);
    visiting.delete(id);
  }
  visit(g.entry);
  for (const n of g.nodes)
    if (!seen.has(n.id)) errors.push(`${n.label} 无法从起点到达`);
  return [...new Set(errors)];
}
export function toGraph(flow: Workflow): FlowGraph {
  if (flow.graph) return structuredClone(flow.graph);
  const names: Record<string, string> = {
    login: "登录",
    navigate: "打开页面",
    click: "点击",
    fill: "填写",
    select: "选择选项",
    press: "按键",
    wait: "等待就绪",
    checkResults: "判断查询结果",
    extract: "读取结果",
    download: "下载文件",
  };
  return {
    entry: "step_1",
    nodes: [
      ...flow.steps.map((s, i) => ({
        id: `step_${i + 1}`,
        label: `步骤 ${i + 1} · ${names[s.type]}`,
        kind: "action" as const,
        stepIndex: i,
        next: i === flow.steps.length - 1 ? "end" : `step_${i + 2}`,
        x: 60,
        y: 40 + i * 110,
      })),
      {
        id: "end",
        label: "结束",
        kind: "end",
        message: "流程已完成",
        status: "succeeded",
        x: 60,
        y: 40 + flow.steps.length * 110,
      },
    ],
  };
}
export function compactGraphWorkflow(flow: Workflow): Workflow {
  if (!flow.graph) return structuredClone(flow);
  const used = [
    ...new Set(
      flow.graph.nodes.flatMap((n) =>
        n.kind === "action" ? [n.stepIndex] : [],
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    ...structuredClone(flow),
    steps: used.map((i) => structuredClone(flow.steps[i])),
    graph: {
      ...flow.graph,
      nodes: flow.graph.nodes.map((n) =>
        n.kind === "action"
          ? { ...n, stepIndex: used.indexOf(n.stepIndex) }
          : { ...n },
      ),
    },
  };
}
