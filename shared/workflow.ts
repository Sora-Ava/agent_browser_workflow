import { z } from "zod";

const selector = z
  .string()
  .min(1)
  .max(4000)
  .refine(
    (s) =>
      !/@e\d+/.test(s) && !s.startsWith("-") && !s.includes("data-abw-index"),
    "必须使用稳定 CSS 定位，不能使用 @e 引用",
  );
const value = z.union([
  z.string().max(10000),
  z.object({ parameter: z.string() }),
  z.object({ credential: z.enum(["username", "password"]) }),
]);
export const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("login"),
    usernameSelector: selector,
    passwordSelector: selector,
    submitSelector: selector,
    successSelector: selector,
  }),
  z.object({
    type: z.literal("navigate"),
    url: z.url().refine((s) => /^https?:/.test(s)),
  }),
  z.object({ type: z.literal("click"), selector }),
  z.object({ type: z.literal("fill"), selector, value }),
  z.object({ type: z.literal("select"), selector, value }),
  z.object({
    type: z.literal("press"),
    key: z.enum(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"]),
  }),
  z.object({ type: z.literal("wait"), selector }),
  z.object({
    type: z.literal("checkResults"),
    emptySelector: selector,
    dataSelector: selector,
  }),
  z.object({ type: z.literal("extract"), selector }),
  z.object({
    type: z.literal("download"),
    selector,
    filename: z
      .string()
      .min(1)
      .max(150)
      .refine(
        (s) => /^[^<>:"/\\|?*\x00-\x1f]+$/.test(s) && !s.startsWith("."),
        "仅填写文件名",
      ),
  }),
]);
export const parameterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/),
  label: z.string().min(1).max(80),
  defaultValue: z.string().max(10000),
});
export const workflowSchema = z
  .object({
    name: z.string().min(1).max(100),
    startUrl: z.url().refine((s) => /^https?:/.test(s)),
    parameters: z.array(parameterSchema).max(30),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .superRefine((w, ctx) => {
    const names = new Set(w.parameters.map((p) => p.name));
    if (names.size !== w.parameters.length)
      ctx.addIssue({ code: "custom", message: "参数名称重复" });
    for (const s of w.steps)
      if (
        "value" in s &&
        typeof s.value === "object" &&
        "parameter" in s.value &&
        !names.has(s.value.parameter)
      )
        ctx.addIssue({
          code: "custom",
          message: `未声明参数 ${s.value.parameter}`,
        });
  });
export type Workflow = z.infer<typeof workflowSchema>;
export type Step = z.infer<typeof stepSchema>;
export function bindValue(
  v: z.infer<typeof value>,
  values: Record<string, string>,
  credential?: { username: string; password: string },
): string {
  if (typeof v === "string") return v;
  if ("credential" in v) {
    if (!credential) throw new Error("请先选择站点凭据");
    return credential[v.credential];
  }
  if (!Object.hasOwn(values, v.parameter))
    throw new Error(`缺少参数：${v.parameter}`);
  return values[v.parameter];
}
export function validateValues(w: Workflow, values: Record<string, string>) {
  for (const p of w.parameters)
    if (!Object.hasOwn(values, p.name) || typeof values[p.name] !== "string")
      throw new Error(`缺少参数：${p.label}`);
  for (const name of Object.keys(values))
    if (!w.parameters.some((p) => p.name === name))
      throw new Error(`未知参数：${name}`);
}
