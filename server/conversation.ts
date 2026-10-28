import { randomUUID } from "node:crypto";
import { inferInputParameters } from "../shared/input-parameters.ts";
import {
  stepSchema,
  workflowSchema,
  type Step,
  type Workflow,
} from "../shared/workflow.ts";

export interface ConversationState {
  id: string;
  startUrl: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  steps: Step[];
  draft: Workflow | null;
}
export class Conversation {
  private value: ConversationState;
  constructor(saved?: ConversationState) {
    this.value = saved || this.empty();
  }
  private empty(): ConversationState {
    return {
      id: randomUUID(),
      startUrl: null,
      messages: [],
      steps: [],
      draft: null,
    };
  }
  state() {
    return structuredClone(this.value);
  }
  reset() {
    this.value = this.empty();
  }
  begin(url: string) {
    if (!this.value.steps.length && /^https?:/.test(url))
      this.value.startUrl = url;
  }
  beginTurn(instruction: string) {
    this.value.messages.push({ role: "user", content: instruction });
  }
  record(input: Step) {
    if (this.value.steps.length >= 100)
      throw new Error("本次会话已录制100个步骤，请保存后新建会话");
    const step = stepSchema.parse(input);
    if (!this.value.startUrl && step.type === "navigate")
      this.value.startUrl = step.url;
    this.value.steps.push(step);
  }
  complete(instruction: string, summary: string, draft: Workflow | null) {
    const last = this.value.messages.at(-1);
    if (last?.role !== "user" || last.content !== instruction)
      this.beginTurn(instruction);
    this.value.messages.push({ role: "assistant", content: summary });
    const steps = structuredClone(this.value.steps);
    const parameters = new Map<string, Workflow["parameters"][number]>();
    for (const source of [this.value.draft, draft]) {
      if (!source) continue;
      const names = new Map<string, string>();
      for (const parameter of source.parameters) {
        let name = parameter.name;
        let suffix = 2;
        while (
          parameters.has(name) &&
          parameters.get(name)!.defaultValue !== parameter.defaultValue
        ) {
          const ending = "_" + suffix++;
          name = parameter.name.slice(0, 51 - ending.length) + ending;
        }
        if (!parameters.has(name) && parameters.size >= 30) continue;
        parameters.set(name, { ...parameter, name });
        names.set(parameter.name, name);
      }
      for (const [index, step] of source.steps.entries()) {
        const actual = steps[index];
        if (
          !actual ||
          !("value" in step) ||
          typeof step.value !== "object" ||
          !("parameter" in step.value) ||
          !("value" in actual)
        )
          continue;
        const name = names.get(step.value.parameter);
        if (name) actual.value = { parameter: name };
      }
    }
    const used = new Set(
      steps.flatMap((s) =>
        "value" in s && typeof s.value === "object" && "parameter" in s.value
          ? [s.value.parameter]
          : [],
      ),
    );
    this.value.draft =
      this.value.startUrl && steps.length
        ? inferInputParameters(
            workflowSchema.parse({
              name: draft?.name || this.value.draft?.name || "对话录制流程",
              startUrl: this.value.startUrl,
              parameters: [...parameters.values()].filter((p) =>
                used.has(p.name),
              ),
              steps,
            }),
          )
        : null;
  }
}
