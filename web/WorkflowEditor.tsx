import { useState, useRef, useEffect } from "react";
import { workflowSchema, type Workflow } from "../shared/workflow.ts";
import { renameParameter } from "../shared/workflow-edit.ts";
export const labels: Record<string, string> = {
  login: "登录",
  navigate: "打开网址",
  click: "点击",
  fill: "填写",
  select: "选择选项",
  press: "按键",
  wait: "等待元素",
  checkResults: "判断查询结果",
  extract: "读取文字",
  download: "下载文件",
};
export const fields: Record<string, string> = {
  selector: "目标定位",
  url: "网址",
  key: "按键",
  filename: "下载文件名",
  usernameSelector: "账号定位",
  passwordSelector: "密码定位",
  submitSelector: "登录按钮定位",
  successSelector: "登录成功标志",
  emptySelector: "无数据标志",
  dataSelector: "有数据标志",
};
export const defaults: Record<string, any> = {
  click: { selector: "" },
  fill: { selector: "", value: "" },
  select: { selector: "", value: "" },
  wait: { selector: "" },
  extract: { selector: "" },
  navigate: { url: "" },
  press: { key: "Enter" },
  download: { selector: "", filename: "export.csv" },
  checkResults: { emptySelector: "", dataSelector: "" },
  login: {
    usernameSelector: "",
    passwordSelector: "",
    submitSelector: "",
    successSelector: "",
  },
};
export function WorkflowEditor({
  workflow,
  onSave,
  onCancel,
}: {
  workflow: Workflow;
  onSave: (w: Workflow) => Promise<void>;
  onCancel: () => void;
}) {
  const [flow, setFlow] = useState<Workflow>(() => structuredClone(workflow));
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start" });
  }, []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function patch(index: number, changes: any) {
    setFlow((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...changes } : s)),
    }));
  }
  function move(index: number, delta: number) {
    setFlow((f) => {
      const steps = [...f.steps];
      [steps[index], steps[index + delta]] = [
        steps[index + delta],
        steps[index],
      ];
      return { ...f, steps };
    });
  }
  async function save() {
    setError("");
    setSaving(true);
    try {
      const parsed = workflowSchema.safeParse(flow);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("；"),
        );
      await onSave(parsed.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section ref={panel} className="workflow-editor" aria-label="流程编辑">
      <h2>编辑流程与参数</h2>
      <p>编辑不会操作网页。保存为新版本后，可使用单步测试验证。</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={saving}>
        <label>
          流程名称
          <input
            value={flow.name}
            onChange={(e) => setFlow({ ...flow, name: e.target.value })}
          />
        </label>
        <label>
          起始网址
          <input
            value={flow.startUrl}
            onChange={(e) => setFlow({ ...flow, startUrl: e.target.value })}
          />
        </label>
        <h3>运行参数</h3>
        {flow.parameters.map((p, i) => (
          <div className="editor-parameter" key={i}>
            <label>
              参数标识
              <input
                defaultValue={p.name}
                key={p.name}
                onBlur={(e) => {
                  if (e.target.value === p.name) return;
                  try {
                    setFlow(renameParameter(flow, p.name, e.target.value));
                    setError("");
                  } catch (err: any) {
                    setError(err.message);
                    e.target.value = p.name;
                  }
                }}
              />
            </label>
            <label>
              显示名称
              <input
                value={p.label}
                onChange={(e) =>
                  setFlow({
                    ...flow,
                    parameters: flow.parameters.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label>
              默认值
              <input
                value={p.defaultValue}
                onChange={(e) =>
                  setFlow({
                    ...flow,
                    parameters: flow.parameters.map((x, j) =>
                      j === i ? { ...x, defaultValue: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (
                  flow.steps.some(
                    (s) =>
                      "value" in s &&
                      typeof s.value === "object" &&
                      "parameter" in s.value &&
                      s.value.parameter === p.name,
                  )
                ) {
                  setError("请先解除步骤中的参数绑定，再删除参数");
                  return;
                }
                setFlow({
                  ...flow,
                  parameters: flow.parameters.filter((_, j) => j !== i),
                });
              }}
            >
              删除参数
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={flow.parameters.length >= 30}
          onClick={() => {
            let n = 1;
            while (flow.parameters.some((p) => p.name === "input_" + n)) n++;
            setFlow({
              ...flow,
              parameters: [
                ...flow.parameters,
                { name: "input_" + n, label: "新参数", defaultValue: "" },
              ],
            });
          }}
        >
          添加参数
        </button>
        <h3>操作步骤</h3>
        {flow.steps.map((s, i) => (
          <div className="editor-step" key={i}>
            <header>
              <strong>步骤 {i + 1}</strong>
              <button
                type="button"
                disabled={Boolean(flow.graph) || i === 0}
                onClick={() => move(i, -1)}
              >
                上移
              </button>
              <button
                type="button"
                disabled={Boolean(flow.graph) || i === flow.steps.length - 1}
                onClick={() => move(i, 1)}
              >
                下移
              </button>
              <button
                type="button"
                disabled={Boolean(flow.graph) || flow.steps.length === 1}
                onClick={() =>
                  setFlow({
                    ...flow,
                    steps: flow.steps.filter((_, j) => i !== j),
                  })
                }
              >
                删除步骤
              </button>
            </header>
            <label>
              动作
              <select
                value={s.type}
                onChange={(e) =>
                  setFlow({
                    ...flow,
                    steps: flow.steps.map((x, j) =>
                      j === i
                        ? { type: e.target.value, ...defaults[e.target.value] }
                        : x,
                    ),
                  })
                }
              >
                {Object.entries(labels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {Object.entries(s)
              .filter(([k]) => k !== "type" && k !== "value")
              .map(([k, v]) => (
                <label key={k}>
                  {fields[k] || k}
                  {k === "key" ? (
                    <select
                      value={String(v)}
                      onChange={(e) => patch(i, { [k]: e.target.value })}
                    >
                      {["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].map(
                        (key) => (
                          <option key={key}>{key}</option>
                        ),
                      )}
                    </select>
                  ) : (
                    <input
                      value={String(v)}
                      onChange={(e) => patch(i, { [k]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            {"value" in s && (
              <>
                <label>
                  输入来源
                  <select
                    aria-label={`步骤 ${i + 1} 输入来源`}
                    value={
                      typeof s.value === "string"
                        ? "fixed"
                        : "parameter" in s.value
                          ? "parameter"
                          : s.value.credential
                    }
                    onChange={(e) => {
                      const kind = e.target.value;
                      if (kind === "parameter" && !flow.parameters.length) {
                        setError("请先添加运行参数");
                        return;
                      }
                      patch(i, {
                        value:
                          kind === "fixed"
                            ? ""
                            : kind === "parameter"
                              ? { parameter: flow.parameters[0].name }
                              : { credential: kind },
                      });
                    }}
                  >
                    <option value="fixed">固定值</option>
                    <option value="parameter">运行参数</option>
                    <option value="username">已保存账号</option>
                    <option value="password">已保存密码</option>
                  </select>
                </label>
                {typeof s.value === "string" ? (
                  <label>
                    固定值
                    <input
                      value={s.value}
                      onChange={(e) => patch(i, { value: e.target.value })}
                    />
                  </label>
                ) : "parameter" in s.value ? (
                  <label>
                    绑定参数
                    <select
                      value={s.value.parameter}
                      onChange={(e) =>
                        patch(i, { value: { parameter: e.target.value } })
                      }
                    >
                      {flow.parameters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.label}（{p.name}）
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p>运行时读取所选站点凭据，不在流程中保存账号密码正文。</p>
                )}
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={Boolean(flow.graph) || flow.steps.length >= 100}
          onClick={() =>
            setFlow({
              ...flow,
              steps: [...flow.steps, { type: "click", selector: "" }],
            })
          }
        >
          添加步骤
        </button>
        <div className="editor-actions">
          <button type="button" className="primary" onClick={save}>
            保存为新版本
          </button>
          <button type="button" onClick={onCancel}>
            取消编辑
          </button>
        </div>
      </fieldset>
    </section>
  );
}
