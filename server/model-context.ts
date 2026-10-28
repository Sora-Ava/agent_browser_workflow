// Character budgets bound request growth without relying on provider tokenizers.
export function modelMessages(input: any[]): any[] {
  const copy = structuredClone(input);
  const hasObservation = (m: any) =>
    typeof m.content === "string" &&
    (/"observationId"/.test(m.content) || m.content.startsWith("当前页面观察"));
  const lastObservation = copy.findLastIndex(hasObservation);
  const currentGoal = copy.findLastIndex(
    (m) => m.role === "user" && !hasObservation(m),
  );
  for (const [i, m] of copy.entries()) {
    if (hasObservation(m)) {
      try {
        const offset = m.content.indexOf("{");
        const data = JSON.parse(m.content.slice(offset));
        const trim = (o: any): any => {
          if (!o || typeof o !== "object") return o;
          if (o.observationId) {
            const elements: any[] = [];
            let chars = 0;
            for (const e of o.elements || []) {
              const compact = {
                ...e,
                name: e.name?.slice(0, 100),
                text: e.text?.slice(0, 100),
              };
              const size = JSON.stringify(compact).length;
              if (chars + size > 9000) break;
              chars += size;
              elements.push(compact);
            }
            return {
              observationId: o.observationId,
              surface: o.surface,
              elements,
              truncated: o.truncated || elements.length !== o.elements?.length,
              context: (o.context || o.snapshot || "").slice(0, 2000),
            };
          }
          if (o.observation) return { ...o, observation: trim(o.observation) };
          return o;
        };
        if (i !== lastObservation)
          m.content = JSON.stringify({
            result: data.result,
            note: "旧观察已过期，使用最新元素编号",
          });
        else m.content = JSON.stringify(trim(data));
      } catch {
        if (i !== lastObservation) m.content = "旧观察已过期";
        else m.content = m.content.slice(0, 12000);
      }
    } else if (
      typeof m.content === "string" &&
      m.role !== "system" &&
      i !== currentGoal
    )
      m.content = m.content.slice(0, m.role === "tool" ? 2000 : 800);
  }
  const firstTool = copy.findIndex(
    (m) => m.role === "assistant" && m.tool_calls?.length,
  );
  if (firstTool < 0) return copy;
  const prefix = copy.slice(0, firstTool);
  const groups: any[][] = [];
  for (const m of copy.slice(firstTool)) {
    if (m.role === "assistant") groups.push([m]);
    else if (groups.length) groups.at(-1)!.push(m);
  }
  // Preserve complete assistant/tool pairs, never orphan tool_call_id messages.
  return [...prefix, ...groups.slice(-4).flat()];
}
