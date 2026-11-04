import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  toGraph,
  compactGraphWorkflow,
  successors,
  type GraphNode,
} from "../shared/graph.ts";
import {
  workflowSchema,
  type Workflow,
  type Step,
} from "../shared/workflow.ts";
import { labels, fields, defaults } from "./WorkflowEditor.tsx";

export function GraphEditor({
  workflow,
  editing,
  run,
  onEdit,
  onCancel,
  onSave,
  onParameters,
  renderStepActions,
}: {
  workflow: Workflow;
  editing: boolean;
  run?: any;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (w: Workflow) => Promise<void>;
  onParameters: () => void;
  renderStepActions: (step: Step, index: number) => ReactNode;
}) {
  const [flow, setFlow] = useState<Workflow>(() => ({
    ...structuredClone(workflow),
    graph: toGraph(workflow),
  }));
  const [selected, setSelected] = useState(flow.graph!.entry);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (editing) panel.current?.scrollIntoView({ block: "start" });
  }, [editing]);
  const graph = flow.graph!;
  const node = graph.nodes.find((n) => n.id === selected);
  const locked = !editing || saving;
  const coords = (n: GraphNode) => ({
    x: n.x ?? 60,
    y: n.y ?? graph.nodes.indexOf(n) * 110 + 40,
  });
  const width = Math.max(900, ...graph.nodes.map((n) => coords(n).x + 280)),
    height = Math.max(420, ...graph.nodes.map((n) => coords(n).y + 120));
  function patch(id: string, changes: any) {
    setFlow((f) => ({
      ...f,
      graph: {
        ...f.graph!,
        nodes: f.graph!.nodes.map((n) =>
          n.id === id ? { ...n, ...changes } : n,
        ),
      },
    }));
  }
  function patchStep(index: number, changes: any) {
    setFlow((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...changes } : s)),
    }));
  }
  function add(kind: GraphNode["kind"]) {
    if (graph.nodes.length >= 150) {
      setError("最多150个节点");
      return;
    }
    if (kind === "action" && flow.steps.length >= 100) {
      setError("最多100个动作步骤");
      return;
    }
    const id = "node_" + crypto.randomUUID().replaceAll("-", "");
    const pos = node ? coords(node) : { x: 0, y: 0 };
    const end = graph.nodes.find((n) => n.kind === "end")?.id || "";
    const common = {
      id,
      label:
        kind === "action" ? "新动作" : kind === "condition" ? "新条件" : "结束",
      x: Math.min(pos.x + 300, 28000),
      y: Math.min(pos.y + 100, 28000),
    };
    const next: GraphNode =
      kind === "action"
        ? { ...common, kind, stepIndex: flow.steps.length, next: end }
        : kind === "condition"
          ? {
              ...common,
              kind,
              test: "visible",
              readySelector: "",
              selector: "",
              yes: end,
              no: end,
            }
          : { ...common, kind, message: "流程已完成", status: "succeeded" };
    setFlow({
      ...flow,
      steps:
        kind === "action"
          ? [...flow.steps, { type: "click", selector: "" }]
          : flow.steps,
      graph: { ...graph, nodes: [...graph.nodes, next] },
    });
    setSelected(id);
    setError("新增节点后，请设置内容，并将它连接到起点可达的路径。");
  }
  async function save() {
    setError("");
    setSaving(true);
    try {
      const parsed = workflowSchema.safeParse(compactGraphWorkflow(flow));
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((i) => i.message).join("；"));
      await onSave(parsed.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  function destination(label: string, key: string, value: string) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={locked}
          onChange={(e) => node && patch(node.id, { [key]: e.target.value })}
        >
          <option value="">未连接</option>
          {graph.nodes
            .filter((n) => n.id !== node?.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}（
                {n.kind === "action"
                  ? "动作"
                  : n.kind === "condition"
                    ? "条件"
                    : "结束"}
                ）
              </option>
            ))}
        </select>
      </label>
    );
  }
  const step = node?.kind === "action" ? flow.steps[node.stepIndex] : undefined;
  const belongs = run?.workflowId === (workflow as any).id;
  const states = belongs ? run?.nodeStates || {} : {};
  return (
    <section className="graph-panel" ref={panel} aria-label="流程图">
      <div className="graph-heading">
        <div>
          <h2>流程图</h2>
          <p>
            {editing
              ? "拖动节点调整位置，点击节点设置内容和出口。修改不会执行网页操作。"
              : "点击节点查看内容；运行时显示实际经过的路径。"}
          </p>
        </div>
        <div className="graph-toolbar">
          {!editing && (
            <button onClick={onParameters}>编辑参数与流程信息</button>
          )}
          {!editing && <button onClick={onEdit}>编辑流程图</button>}
        </div>
      </div>
      {belongs && run?.summary && <p role="status">{run.summary}</p>}
      {belongs && run?.error && (
        <p role="alert" className="graph-error">
          {run.error}
        </p>
      )}
      {error && (
        <p role="alert" className="graph-error">
          {error}
        </p>
      )}
      {editing && (
        <div className="graph-controls">
          <button disabled={saving} onClick={() => add("action")}>
            添加动作节点
          </button>
          <button disabled={saving} onClick={() => add("condition")}>
            添加条件节点
          </button>
          <button disabled={saving} onClick={() => add("end")}>
            添加结束节点
          </button>
          <label>
            起始节点
            <select
              disabled={saving}
              value={graph.entry}
              onChange={(e) =>
                setFlow({ ...flow, graph: { ...graph, entry: e.target.value } })
              }
            >
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="graph-layout">
        <div className="graph-scroll">
          <div className="graph-canvas" style={{ width, height }}>
            <svg
              width={width}
              height={height}
              className="graph-edges"
              aria-label="节点连接"
            >
              <defs>
                <marker
                  id="graph-arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill="#75849b" />
                </marker>
              </defs>
              {graph.nodes.flatMap((source) =>
                successors(source).map((id, i) => {
                  const target = graph.nodes.find((n) => n.id === id);
                  if (!target) return null;
                  const a = coords(source),
                    b = coords(target);
                  const sx = a.x + 110,
                    sy = a.y + 64,
                    tx = b.x + 110,
                    ty = b.y;
                  const offset =
                    source.kind === "condition" ? (i === 0 ? -22 : 22) : 0;
                  const taken =
                    source.kind === "condition" &&
                    typeof states[source.id]?.result?.matched === "boolean" &&
                    states[source.id].result.matched === (i === 0);
                  return (
                    <g key={source.id + ":" + i}>
                      <path
                        className={taken ? "taken" : ""}
                        d={`M${sx + offset},${sy} C${sx + offset},${sy + 40} ${tx},${ty - 40} ${tx},${ty}`}
                        markerEnd="url(#graph-arrow)"
                      />
                      {source.kind === "condition" && (
                        <text x={sx + offset + 8} y={sy + 22}>
                          {i === 0 ? "是" : "否"}
                        </text>
                      )}
                    </g>
                  );
                }),
              )}
            </svg>
            {graph.nodes.map((n) => {
              const p = coords(n);
              const state = states[n.id]?.status;
              return (
                <button
                  key={n.id}
                  data-node-id={n.id}
                  className={`graph-node ${n.kind} ${selected === n.id ? "selected" : ""} ${state || ""}`}
                  style={{ left: p.x, top: p.y }}
                  onClick={() => setSelected(n.id)}
                  onPointerDown={(e) => {
                    if (locked || e.button !== 0) return;
                    setSelected(n.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const startX = e.clientX,
                      startY = e.clientY;
                    const el = e.currentTarget;
                    const move = (event: PointerEvent) =>
                      patch(n.id, {
                        x: Math.min(
                          29000,
                          Math.max(0, p.x + event.clientX - startX),
                        ),
                        y: Math.min(
                          29000,
                          Math.max(0, p.y + event.clientY - startY),
                        ),
                      });
                    const stop = () => {
                      el.removeEventListener("pointermove", move);
                      el.removeEventListener("pointerup", stop);
                      el.removeEventListener("pointercancel", stop);
                    };
                    el.addEventListener("pointermove", move);
                    el.addEventListener("pointerup", stop);
                    el.addEventListener("pointercancel", stop);
                  }}
                >
                  <small>
                    {n.kind === "action"
                      ? "动作"
                      : n.kind === "condition"
                        ? "◇ 条件"
                        : "结束"}
                    {graph.entry === n.id ? " · 起点" : ""}
                    {state
                      ? ` · ${state === "running" ? "正在运行" : state === "failed" ? "失败" : "已完成"}`
                      : ""}
                  </small>
                  <strong>{n.label}</strong>
                </button>
              );
            })}
          </div>
        </div>
        <aside className="graph-inspector">
          {node && (
            <header className="node-inspector-heading">
              <small>当前节点</small>
              <h3>{node.label}</h3>
            </header>
          )}
          {node?.kind === "action" &&
            step &&
            !editing &&
            renderStepActions(step, node.stepIndex)}
          {editing && <p>保存流程图后，可在此测试节点或手动选择元素。</p>}
          {node && (
            <fieldset disabled={locked}>
              <legend>节点设置</legend>
              <label>
                节点名称
                <input
                  value={node.label}
                  onChange={(e) => patch(node.id, { label: e.target.value })}
                />
              </label>
              {node.kind === "action" && step && (
                <>
                  <label>
                    动作
                    <select
                      value={step.type}
                      onChange={(e) =>
                        setFlow({
                          ...flow,
                          steps: flow.steps.map((s, i) =>
                            i === node.stepIndex
                              ? {
                                  type: e.target.value,
                                  ...defaults[e.target.value],
                                }
                              : s,
                          ),
                        })
                      }
                    >
                      {Object.entries(labels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {Object.entries(step)
                    .filter(([k]) => k !== "type" && k !== "value")
                    .map(([key, value]) => (
                      <label key={key}>
                        {fields[key] || key}
                        <input
                          value={String(value)}
                          onChange={(e) =>
                            patchStep(node.stepIndex, { [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  {"value" in step && (
                    <>
                      <label>
                        输入来源
                        <select
                          value={
                            typeof step.value === "string"
                              ? "fixed"
                              : "parameter" in step.value
                                ? "parameter"
                                : step.value.credential
                          }
                          onChange={(e) => {
                            if (
                              e.target.value === "parameter" &&
                              !flow.parameters.length
                            ) {
                              setError(
                                "请先保存或取消流程图编辑，再通过“编辑参数与流程信息”添加参数",
                              );
                              return;
                            }
                            patchStep(node.stepIndex, {
                              value:
                                e.target.value === "fixed"
                                  ? ""
                                  : e.target.value === "parameter"
                                    ? { parameter: flow.parameters[0].name }
                                    : { credential: e.target.value },
                            });
                          }}
                        >
                          <option value="fixed">固定值</option>
                          <option value="parameter">运行参数</option>
                          <option value="username">已保存账号</option>
                          <option value="password">已保存密码</option>
                        </select>
                      </label>
                      {typeof step.value === "string" ? (
                        <label>
                          固定值
                          <input
                            value={step.value}
                            onChange={(e) =>
                              patchStep(node.stepIndex, {
                                value: e.target.value,
                              })
                            }
                          />
                        </label>
                      ) : "parameter" in step.value ? (
                        <label>
                          绑定参数
                          <select
                            value={step.value.parameter}
                            onChange={(e) =>
                              patchStep(node.stepIndex, {
                                value: { parameter: e.target.value },
                              })
                            }
                          >
                            {flow.parameters.map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p>运行时读取站点凭据。</p>
                      )}
                    </>
                  )}
                  {destination("下一节点", "next", node.next)}
                </>
              )}
              {node.kind === "condition" && (
                <>
                  <label>
                    判断方式
                    <select
                      value={node.test}
                      onChange={(e) => patch(node.id, { test: e.target.value })}
                    >
                      <option value="visible">元素是否可见</option>
                      <option value="textContains">文字是否包含</option>
                    </select>
                  </label>
                  <label>
                    结果就绪标志
                    <input
                      placeholder="查询完成后出现的唯一元素定位"
                      value={node.readySelector}
                      onChange={(e) =>
                        patch(node.id, { readySelector: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    条件目标定位
                    <input
                      value={node.selector}
                      onChange={(e) =>
                        patch(node.id, { selector: e.target.value })
                      }
                    />
                  </label>
                  {node.test === "textContains" && (
                    <label>
                      包含文字
                      <input
                        value={node.text || ""}
                        onChange={(e) =>
                          patch(node.id, { text: e.target.value })
                        }
                      />
                    </label>
                  )}
                  {destination("是 →", "yes", node.yes)}
                  {destination("否 →", "no", node.no)}
                  <p>
                    先等待就绪标志，再判断条件。目标在两种结果下都应存在；动态增删的结果请对稳定容器使用文字判断。超时、定位不存在、不唯一或读取失败会停止。
                  </p>
                </>
              )}
              {node.kind === "end" && (
                <>
                  <label>
                    结束提示
                    <textarea
                      value={node.message}
                      onChange={(e) =>
                        patch(node.id, { message: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    结束状态
                    <select
                      value={node.status}
                      onChange={(e) =>
                        patch(node.id, { status: e.target.value })
                      }
                    >
                      <option value="succeeded">执行完成</option>
                      <option value="no_data">没有数据</option>
                    </select>
                  </label>
                </>
              )}
              {editing && (
                <button
                  disabled={graph.nodes.length <= 1}
                  onClick={() => {
                    setFlow({
                      ...flow,
                      graph: {
                        entry:
                          graph.entry === node.id
                            ? graph.nodes.find((n) => n.id !== node.id)!.id
                            : graph.entry,
                        nodes: graph.nodes.filter((n) => n.id !== node.id),
                      },
                    });
                    setSelected(graph.nodes.find((n) => n.id !== node.id)!.id);
                    setError("请检查指向已删除节点的连接并重新设置。");
                  }}
                >
                  删除此节点
                </button>
              )}
            </fieldset>
          )}
        </aside>
      </div>
      <p className="graph-legend">
        蓝色：正在运行　绿色：已完成　红色：失败　灰色：未运行。条件节点的“是 /
        否”出口分别设置。
      </p>
      {editing && (
        <div className="editor-actions">
          <button className="primary" disabled={saving} onClick={save}>
            保存流程图新版本
          </button>
          <button disabled={saving} onClick={onCancel}>
            取消流程图编辑
          </button>
        </div>
      )}
    </section>
  );
}
