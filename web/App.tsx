import { useEffect, useState, useRef } from "react";
import type { Workflow, Step } from "../shared/workflow.ts";
import { demoWorkflow } from "../shared/demo-workflow.ts";
import { inputRows, toggleInputParameter } from "../shared/input-parameters.ts";
function targetLabel(selector: string) {
  try {
    const d = selector.startsWith("element:")
      ? JSON.parse(selector.slice(8))
      : selector.startsWith("text:")
        ? JSON.parse(selector.slice(5))
        : null;
    return d
      ? [d.region, d.name || d.text || d.tag].filter(Boolean).join(" / ")
      : selector;
  } catch {
    return selector;
  }
}

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "请求失败");
  return json;
}
const statusText: Record<string, string> = {
  running: "正在执行",
  pausing: "等待暂停",
  paused: "已暂停",
  repairing: "正在修复定位",
  succeeded: "执行完成",
  no_data: "未查询到数据",
  failed: "执行失败",
  cancelled: "已停止",
  interrupted: "运行已中断",
};
const stepText: Record<Step["type"], string> = {
  navigate: "打开页面",
  login: "登录站点",
  click: "点击",
  fill: "填写",
  select: "选择",
  press: "按键",
  wait: "等待页面就绪",
  checkResults: "判断查询结果",
  extract: "读取结果",
  download: "下载文件",
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "grid" ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : name === "play" ? (
        <path d="m8 4 12 8-12 8z" />
      ) : name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
        </>
      ) : name === "history" ? (
        <>
          <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7" />
          <path d="M12 7v5l3 2" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 22h8m-4-4v4" />
        </>
      )}
    </svg>
  );
}
function DeleteDialog({
  target,
  allVersions,
  setAllVersions,
  onCancel,
  onDelete,
  busy,
}: {
  target: any;
  allVersions: boolean;
  setAllVersions: (value: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="delete-dialog"
      aria-labelledby="delete-title"
      onCancel={onCancel}
    >
      <h2 id="delete-title">删除流程</h2>
      <p>
        删除“{target.name}”的版本 {target.version || 1}
        ？运行历史、账号凭据和下载文件会保留。
      </p>
      <label className="delete-scope">
        <input
          type="checkbox"
          checked={allVersions}
          onChange={(e) => setAllVersions(e.target.checked)}
        />
        同时删除该流程的全部版本
      </label>
      <div className="dialog-actions">
        <button
          className="secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button className="delete-confirm" disabled={busy} onClick={onDelete}>
          {allVersions ? "删除全部版本" : "删除此版本"}
        </button>
      </div>
    </dialog>
  );
}

export function App() {
  const [view, setView] = useState("work");
  const [settings, setSettings] = useState<any>(null);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [state, setState] = useState<any>({ history: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [credential, setCredential] = useState({
    origin: "http://127.0.0.1:3001",
    alias: "",
    username: "",
    password: "",
  });
  const running = ["running", "pausing", "paused", "repairing"].includes(
    state.active?.status,
  );
  const browserReady = state.browser?.status === "ready";
  async function refresh() {
    const [s, w, c] = await Promise.all([
      api("settings"),
      api("workflows"),
      api("credentials"),
    ]);
    setSettings(s);
    setWorkflows(w);
    setCredentials(c);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    let live = true;
    const update = () =>
      api("state")
        .then((s) => {
          if (live) setState(s);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    update();
    const timer = setInterval(update, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const events = new EventSource("/api/live");
    events.addEventListener("frame", (event) => {
      try {
        const frame = JSON.parse((event as MessageEvent).data);
        setLiveFrame(`data:${frame.mime};base64,${frame.data}`);
      } catch {
        setLiveFrame(null);
      }
    });
    events.addEventListener("mode", (event) => {
      if (JSON.parse((event as MessageEvent).data) !== "live")
        setLiveFrame(null);
    });
    events.onerror = () => setLiveFrame(null);
    return () => events.close();
  }, []);
  useEffect(() => {
    if (!selected) setDraft(state.conversation?.draft || null);
  }, [
    state.active?.id,
    state.active?.status,
    state.conversation?.id,
    state.conversation?.steps?.length,
    selected?.id,
  ]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [state.conversation?.messages?.length]);
  useEffect(() => {
    const run = state.active;
    if (run?.repairedVersionId && !running)
      void api("workflows")
        .then((list) => {
          setWorkflows(list);
          const version = list.find((w: any) => w.id === run.repairedVersionId);
          if (version) {
            setSelected((previous: any) =>
              previous?.id === run.workflowId ? version : previous,
            );
            setNotice(
              `修复成功，已保存版本 ${version.version}；旧版本仍可选择。`,
            );
          }
        })
        .catch((e) => setError(e.message));
  }, [state.active?.id, state.active?.status]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function choose(w: any) {
    setSelected(w);
    setDraft(null);
    setValues(
      Object.fromEntries(
        w.parameters.map((p: any) => [p.name, p.defaultValue]),
      ),
    );
    setView("work");
  }
  async function saveDraft() {
    if (!draft) return;
    const saved = await api("workflows", "POST", draft);
    await refresh();
    choose(saved);
    setNotice("流程已保存，下次填写参数即可运行。");
  }
  async function launchBrowser() {
    await api("browser/start", "POST", {
      url: selected?.startUrl || startUrl.trim() || undefined,
    });
    setState(await api("state"));
    setNotice("浏览器已启动，可以逐条发送指令。");
  }
  async function sendInstruction() {
    if (!instruction.trim()) return;
    await api("chat", "POST", {
      instruction: instruction.trim(),
      credentialId: credentialId || undefined,
    });
    setInstruction("");
    setState(await api("state"));
  }
  async function newConversation() {
    if (
      state.conversation?.steps?.length &&
      !window.confirm(
        "新建会话会清空尚未保存的对话录制；已保存流程不受影响。继续吗？",
      )
    )
      return;
    await api("conversation/reset", "POST");
    setSelected(null);
    setDraft(null);
    setInstruction("");
    setState(await api("state"));
  }
  async function deleteWorkflow() {
    await api(
      "workflows/" + deleteTarget.id + "?allVersions=" + deleteAll,
      "DELETE",
    );
    const list = await api("workflows");
    setWorkflows(list);
    if (selected && !list.some((w: any) => w.id === selected.id)) {
      setSelected(null);
      setDraft(state.conversation?.draft || null);
    }
    setDeleteTarget(null);
    setNotice("流程已删除，历史记录和下载文件已保留。");
  }
  const active = state.active;
  return (
    <div className="shell">
      <aside className="navigation">
        <a
          className="brand"
          href="#"
          aria-label="行迹首页"
          onClick={() => setView("work")}
        >
          <span className="brand-mark">行</span>
          <span>
            行迹<small>浏览器工作台</small>
          </span>
        </a>
        <div className="nav-caption">工作空间</div>
        {[
          ["work", "monitor", "操作台"],
          ["flows", "grid", "我的流程"],
          ["history", "history", "运行记录"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={"nav-item " + (view === id ? "active" : "")}
            onClick={() => {
              setView(id);
              if (id === "flows")
                void refresh().catch((e) => setError(e.message));
            }}
          >
            <Icon name={icon} />
            {label}
            {id === "flows" && (
              <span className="count">{workflows.length}</span>
            )}
          </button>
        ))}
        <div className="saved-nav">
          <div className="nav-caption">最近保存</div>
          {workflows.slice(0, 5).map((w) => (
            <button key={w.id} className="flow-short" onClick={() => choose(w)}>
              <span className="flow-dot" />
              {w.name}
            </button>
          ))}
          {!workflows.length && <p>成功执行后，把操作保存为流程。</p>}
        </div>
        <div className="nav-bottom">
          <button
            className={"nav-item " + (view === "settings" ? "active" : "")}
            onClick={() => setView("settings")}
          >
            <Icon name="settings" />
            模型与站点设置
          </button>
          <span className="local-tag">
            <i />
            本机运行 · 数据保存在本地
          </span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            我的工作空间 <span>/</span>{" "}
            {view === "work"
              ? "操作台"
              : view === "flows"
                ? "我的流程"
                : view === "history"
                  ? "运行记录"
                  : "设置"}
          </div>
          <span className="version">最小版本 0.1</span>
        </header>
        {error && (
          <div role="alert" className="banner error">
            {error}
            <button aria-label="关闭错误" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="banner notice">
            {notice}
          </div>
        )}
        {view === "work" && (
          <>
            <div className="page-heading">
              <div>
                <h1>{selected ? selected.name : "逐步指挥浏览器"}</h1>
                <p>
                  {selected
                    ? "填写本次参数，复用已经保存的操作。"
                    : "每次发送一条指令，执行完成后等待你继续。"}
                </p>
              </div>
              <div className="workspace-actions">
                <button
                  className={browserReady ? "secondary" : "primary"}
                  disabled={
                    busy ||
                    running ||
                    browserReady ||
                    state.browser?.status === "starting"
                  }
                  onClick={() => act(launchBrowser)}
                >
                  {browserReady
                    ? "浏览器已启动"
                    : state.browser?.status === "starting"
                      ? "启动中…"
                      : "启动浏览器"}
                </button>
                {selected && (
                  <button
                    className="secondary"
                    onClick={() => setSelected(null)}
                  >
                    返回对话
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy || running}
                  onClick={() => act(newConversation)}
                >
                  ＋ 新建会话
                </button>
              </div>
            </div>
            <div className="workspace">
              <section className="control-panel">
                <div className="panel-title">
                  <span className="section-number">1</span>
                  <h2>{selected ? "运行参数" : "对话指令"}</h2>
                  <span className="muted">
                    {selected
                      ? "无需模型"
                      : `已录制 ${state.conversation?.steps?.length || 0} 步`}
                  </span>
                </div>
                {selected ? (
                  <div className="form-content">
                    <label>
                      流程版本
                      <select
                        value={selected.id}
                        disabled={running}
                        onChange={(e) =>
                          choose(workflows.find((w) => w.id === e.target.value))
                        }
                      >
                        {workflows
                          .filter(
                            (w) =>
                              (w.rootId || w.id) ===
                              (selected.rootId || selected.id),
                          )
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              版本 {w.version || 1}
                              {w.parentId ? " · 修复后保存" : " · 原始流程"}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      起始网址
                      <input value={selected.startUrl} readOnly />
                    </label>
                    {selected.parameters.map((p: any) => (
                      <label key={p.name}>
                        {p.label}
                        <input
                          value={values[p.name] ?? ""}
                          onChange={(e) =>
                            setValues({ ...values, [p.name]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="form-content">
                    <div
                      className="chat-transcript"
                      role="log"
                      aria-live="polite"
                      aria-label="对话记录"
                    >
                      {!state.conversation?.messages?.length && (
                        <div className="chat-welcome">
                          <strong>你来决定下一步</strong>
                          <p>
                            先启动浏览器，然后逐条发送指令，例如“打开产品系统”“填写查询条件”“点击导出”。
                          </p>
                        </div>
                      )}
                      {state.conversation?.messages?.map(
                        (message: any, index: number) => (
                          <div
                            className={"chat-message " + message.role}
                            key={index}
                          >
                            <span>
                              {message.role === "user" ? "你" : "浏览器助手"}
                            </span>
                            <p>{message.content}</p>
                          </div>
                        ),
                      )}
                      <div ref={chatEnd} />
                    </div>
                    {!browserReady && (
                      <label>
                        启动网址（可选）
                        <input
                          value={startUrl}
                          onChange={(e) => setStartUrl(e.target.value)}
                          placeholder="留空打开浏览器，再用对话指挥"
                        />
                      </label>
                    )}
                    <label>
                      下一步做什么？
                      <textarea
                        rows={3}
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={
                          browserReady
                            ? "例如：填写已保存的账号密码，先不要登录"
                            : "先点击“启动浏览器”"
                        }
                        onKeyDown={(e) => {
                          if (
                            (e.ctrlKey || e.metaKey) &&
                            e.key === "Enter" &&
                            !running &&
                            !busy &&
                            browserReady
                          ) {
                            e.preventDefault();
                            void act(sendInstruction);
                          }
                        }}
                      />
                    </label>
                  </div>
                )}
                <div className="form-content compact">
                  <label>
                    使用站点账号
                    <select
                      value={credentialId}
                      onChange={(e) => setCredentialId(e.target.value)}
                    >
                      <option value="">不使用凭据 / 已手动登录</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.alias} · {c.origin}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field-note">
                    账号在设置中管理；浏览器使用独立登录会话。
                  </p>
                  <button
                    className="primary run-button"
                    disabled={
                      running ||
                      busy ||
                      !browserReady ||
                      (!selected && !instruction.trim())
                    }
                    onClick={() =>
                      act(async () => {
                        if (!selected) {
                          await sendInstruction();
                          return;
                        }
                        await api(
                          "replay",
                          "POST",
                          selected
                            ? {
                                id: selected.id,
                                values,
                                credentialId: credentialId || undefined,
                              }
                            : {
                                startUrl,
                                instruction,
                                credentialId: credentialId || undefined,
                              },
                        );
                        setState(await api("state"));
                      })
                    }
                  >
                    <Icon name="play" />
                    {running
                      ? statusText[active.status] || "正在运行…"
                      : selected
                        ? "运行流程"
                        : "发送指令"}
                  </button>
                  {!selected && (
                    <p className="composer-hint">
                      Ctrl + Enter 发送 · 执行后等待下一条指令
                    </p>
                  )}
                  {running && (
                    <div className="run-controls">
                      <button
                        className="secondary"
                        disabled={busy || active.status === "pausing"}
                        onClick={() =>
                          act(async () => {
                            await api(
                              active.status === "paused" ? "resume" : "pause",
                              "POST",
                            );
                            setState(await api("state"));
                          })
                        }
                      >
                        {active.status === "paused"
                          ? "继续执行"
                          : active.status === "pausing"
                            ? "正在暂停…"
                            : "暂停 / 人工接管"}
                      </button>
                      <button
                        className="danger-button"
                        onClick={() =>
                          act(async () => {
                            await api("cancel", "POST");
                            setNotice("已请求停止，当前浏览器命令结束后生效。");
                          })
                        }
                      >
                        停止后续操作
                      </button>
                    </div>
                  )}
                  {active?.status === "paused" && (
                    <p className="field-note takeover-note">
                      可以在独立浏览器中完成验证码或调整页面，之后点击“继续执行”。
                    </p>
                  )}
                </div>
                <div className="trace-heading">
                  <h2>执行步骤</h2>
                  <span>{active?.events?.length || 0} 步</span>
                </div>
                <div className="trace">
                  {!active?.events?.length ? (
                    <div className="trace-empty">
                      <span className="trace-line" />
                      每一步操作都会显示在这里
                    </div>
                  ) : (
                    active.events.map((event: any, i: number) => (
                      <div className="trace-item" key={i}>
                        <span className="step-index">{i + 1}</span>
                        <div>
                          <strong>
                            {stepText[event.step.type as Step["type"]]}
                          </strong>
                          <small>
                            {event.step.selector ||
                              event.step.url ||
                              event.step.successSelector ||
                              event.step.dataSelector ||
                              event.step.key}
                          </small>
                          {event.output?.path && (
                            <p className="download-path">{event.output.path}</p>
                          )}
                        </div>
                        <span className="step-check">✓</span>
                      </div>
                    ))
                  )}
                </div>
                {selected && (
                  <details className="details">
                    <summary>查看保存的 {selected.steps.length} 个步骤</summary>
                    {selected.steps.map((s: Step, i: number) => (
                      <p key={i}>
                        {i + 1}. {stepText[s.type]}{" "}
                        {"selector" in s ? targetLabel(s.selector) : ""}
                        {"selector" in s && (
                          <button
                            disabled={running || !browserReady}
                            onClick={() =>
                              act(async () => {
                                await api("manual/start", "POST", {
                                  workflowId: selected.id,
                                  index: i,
                                });
                                setNotice(
                                  "请到独立浏览器选择目标（按住Alt可选父元素，不会触发操作），再点击本步骤的确认替换；Esc后请点取消选择以释放会话。",
                                );
                              })
                            }
                          >
                            手动选元素
                          </button>
                        )}
                        {"selector" in s && (
                          <button
                            disabled={running || !browserReady}
                            onClick={() =>
                              act(async () => {
                                const updated = await api(
                                  "manual/replace",
                                  "POST",
                                  { workflowId: selected.id, index: i },
                                );
                                await refresh();
                                choose(updated);
                                setNotice(
                                  "定位已验证并保存为新版本，旧版本保留。",
                                );
                              })
                            }
                          >
                            确认替换定位
                          </button>
                        )}
                        {"selector" in s && (
                          <button
                            disabled={running || !browserReady}
                            onClick={() =>
                              act(async () => {
                                await api("manual/cancel", "POST", {});
                                setNotice("元素选择已结束。");
                              })
                            }
                          >
                            取消选择
                          </button>
                        )}
                        <button
                          disabled={running || !browserReady}
                          onClick={() =>
                            act(async () => {
                              if (
                                !window.confirm(
                                  "将在当前网页实际执行此步骤一次，继续吗？",
                                )
                              )
                                return;
                              await api("manual/test", "POST", {
                                workflowId: selected.id,
                                index: i,
                                values,
                                credentialId: credentialId || undefined,
                              });
                              setState(await api("state"));
                            })
                          }
                        >
                          单步测试
                        </button>
                      </p>
                    ))}
                  </details>
                )}
              </section>
              <section className="browser-panel">
                <div className="browser-toolbar">
                  <div className="window-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="address-bar">
                    <span>▣</span>
                    {(running ? active?.startUrl : undefined) ||
                      selected?.startUrl ||
                      active?.startUrl ||
                      startUrl}
                  </div>
                  <span
                    className={"capture-tag " + (liveFrame ? "live-tag" : "")}
                  >
                    {liveFrame ? "实时画面" : "步骤快照"}
                  </span>
                </div>
                <div className="viewport">
                  {liveFrame || state.frameVersion ? (
                    <img
                      src={liveFrame || "/api/frame?v=" + state.frameVersion}
                      alt="自动化浏览器当前画面"
                    />
                  ) : (
                    <div className="viewport-empty">
                      <div className="browser-illustration">
                        <div>
                          <i />
                          <i />
                          <i />
                        </div>
                        <span />
                        <span />
                        <span />
                      </div>
                      <h2>
                        {browserReady ? "浏览器已启动" : "浏览器尚未启动"}
                      </h2>
                      <p>
                        {browserReady
                          ? "可以开始逐步发送操作指令。"
                          : "点击“启动浏览器”后才会打开独立浏览器。"}
                        <br />
                        页面实时画面会显示在这里。
                      </p>
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            const saved = await api(
                              "workflows",
                              "POST",
                              demoWorkflow,
                            );
                            await refresh();
                            choose(saved);
                            setNotice(
                              "演示流程已载入。请在设置中保存演示凭据：账号 demo，密码 demo123，然后选择该账号运行。",
                            );
                          })
                        }
                      >
                        先试试本机产品查询演示
                      </button>
                    </div>
                  )}
                </div>
                <footer className="browser-footer">
                  <span className={"run-status " + (active?.status || "idle")}>
                    <i />
                    {active
                      ? statusText[active.status] || active.status
                      : "等待开始"}
                  </span>
                  <span>
                    {active
                      ? `模型 ${active.modelCalls} 次${active.repairs ? " · 修复 " + active.repairs + " 次" : ""}`
                      : "独立浏览器 · agent-browser"}
                  </span>
                </footer>
                {active?.error && (
                  <div className="run-error">
                    {active.error}
                    <small>
                      已停止并保留记录。定位失效会自动尝试修复；操作结果不明时不会重复提交。
                    </small>
                  </div>
                )}
                {!!active?.repairLog?.length && (
                  <details className="repair-details">
                    <summary>查看 {active.repairLog.length} 次自动修复</summary>
                    {active.repairLog.map((entry: any, i: number) => (
                      <p key={i}>
                        第 {entry.index + 1} 步：
                        {entry.before.selector ||
                          entry.before.dataSelector} →{" "}
                        {entry.after.selector || entry.after.dataSelector}
                      </p>
                    ))}
                  </details>
                )}
              </section>
            </div>
            {draft && !running && (
              <section className="draft-panel">
                <div>
                  <h2>保存本次对话录制的完整流程（{draft.steps.length} 步）</h2>
                  <p>
                    勾选下次需要修改的输入；未勾选的值保持固定。账号密码引用不会列为参数。
                  </p>
                </div>
                <label>
                  流程名称
                  <input
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                {inputRows(draft).map((row) => (
                  <div className="input-review-row" key={row.indexes.join(",")}>
                    <label className="parameter-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(row.parameter)}
                        onChange={(e) => {
                          try {
                            setDraft(
                              toggleInputParameter(
                                draft,
                                row,
                                e.target.checked,
                              ),
                            );
                          } catch (err: any) {
                            setError(err.message);
                          }
                        }}
                      />
                      下次可修改
                      <small>
                        步骤 {row.indexes.map((i) => i + 1).join("、")}
                      </small>
                    </label>
                    <div className="parameter-edit">
                      <label>
                        参数显示名称
                        <input
                          value={row.label}
                          disabled={!row.parameter}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              parameters: draft.parameters.map((x) =>
                                x.name === row.parameter
                                  ? { ...x, label: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        {row.parameter ? "默认值" : "固定值"}
                        <input
                          value={row.value}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              parameters: draft.parameters.map((x) =>
                                x.name === row.parameter
                                  ? { ...x, defaultValue: e.target.value }
                                  : x,
                              ),
                              steps: row.parameter
                                ? draft.steps
                                : draft.steps.map((s, i) =>
                                    row.indexes.includes(i) &&
                                    (s.type === "fill" || s.type === "select")
                                      ? { ...s, value: e.target.value }
                                      : s,
                                  ),
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {!inputRows(draft).length && (
                  <p>本次没有可设为参数的业务输入。</p>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act(saveDraft)}
                >
                  保存完整流程
                </button>
              </section>
            )}
          </>
        )}
        {view === "flows" && (
          <div className="content-page">
            <h1>我的流程</h1>
            <p className="subtitle">已经完成的操作，下一次直接运行。</p>
            {!workflows.length ? (
              <div className="empty-list">
                还没有保存的流程。前往操作台，完成第一次操作。
              </div>
            ) : (
              <div className="flow-list">
                {workflows.map((w) => (
                  <article className="flow-entry" key={w.id}>
                    <button className="flow-row" onClick={() => choose(w)}>
                      <span className="flow-symbol">
                        <Icon name="grid" />
                      </span>
                      <span>
                        <strong>
                          {w.name}{" "}
                          <span className="version-badge">
                            版本 {w.version || 1}
                          </span>
                        </strong>
                        <small>{w.startUrl}</small>
                      </span>
                      <span>{w.steps.length} 个步骤</span>
                      <span>{w.parameters.length} 个参数</span>
                      <span>运行</span>
                    </button>
                    <button
                      className="flow-delete"
                      aria-label={`删除 ${w.name} 版本 ${w.version || 1}`}
                      disabled={running || busy}
                      onClick={() => {
                        setDeleteTarget(w);
                        setDeleteAll(false);
                      }}
                    >
                      删除
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        {view === "history" && (
          <div className="content-page">
            <h1>运行记录</h1>
            <p className="subtitle">记录保留在本机；中断的任务不会自动重跑。</p>
            {!state.history.length ? (
              <div className="empty-list">还没有执行记录。</div>
            ) : (
              state.history.map((r: any) => (
                <article className="history-row" key={r.id}>
                  <strong>
                    {r.kind === "chat"
                      ? "对话指令"
                      : r.kind === "explore"
                        ? "自然语言操作"
                        : "流程回放"}
                  </strong>
                  <span>{statusText[r.status]}</span>
                  <span>{new Date(r.started).toLocaleString()}</span>
                  <span>模型 {r.modelCalls} 次</span>
                  {r.error && <p>{r.error}</p>}
                </article>
              ))
            )}
          </div>
        )}
        {view === "settings" && settings && (
          <div className="content-page settings-page">
            <h1>模型与站点设置</h1>
            <p className="subtitle">配置只保存在本机，不会提交到代码仓库。</p>
            <section className="settings-section">
              <h2>模型连接</h2>
              <p>支持 OpenAI 兼容 Chat Completions 和工具调用。</p>
              <label>
                API 地址
                <input
                  value={settings.baseUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, baseUrl: e.target.value })
                  }
                />
              </label>
              <div className="two-columns">
                <label>
                  模型名称
                  <input
                    value={settings.model}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                    placeholder="填写服务商提供的模型 ID"
                  />
                </label>
                <label>
                  API 密钥
                  <input
                    type="password"
                    value={key}
                    autoComplete="off"
                    placeholder={
                      settings.hasApiKey ? "已保存，留空保留原密钥" : "输入密钥"
                    }
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
              </div>
              <label>
                下载到本机目录
                <input
                  value={settings.downloadDir}
                  onChange={(e) =>
                    setSettings({ ...settings, downloadDir: e.target.value })
                  }
                />
              </label>
              <label>
                每条指令最多调用模型次数
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={settings.maxModelCalls ?? 8}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxModelCalls: Number(e.target.value),
                    })
                  }
                />
                <small>
                  默认8次；复杂任务可拆分为多条指令。定位失败最多自动恢复1次。
                </small>
              </label>
              <button
                className="primary"
                disabled={busy || running}
                onClick={() =>
                  act(async () => {
                    await api("settings", "PUT", {
                      baseUrl: settings.baseUrl,
                      model: settings.model,
                      apiKey: key,
                      downloadDir: settings.downloadDir,
                    });
                    setKey("");
                    await refresh();
                    setNotice("模型与下载设置已保存。");
                  })
                }
              >
                保存设置
              </button>
            </section>
            <section className="settings-section">
              <h2>站点账号</h2>
              <p>按网址管理账号。首次运行自动登录，已有会话时跳过登录。</p>
              {credentials.map((c) => (
                <div className="credential-row" key={c.id}>
                  <strong>{c.alias}</strong>
                  <span>{c.origin}</span>
                </div>
              ))}
              <div className="two-columns">
                <label>
                  站点网址
                  <input
                    value={credential.origin}
                    onChange={(e) =>
                      setCredential({ ...credential, origin: e.target.value })
                    }
                  />
                </label>
                <label>
                  账号别名
                  <input
                    value={credential.alias}
                    placeholder="例如 演示系统"
                    onChange={(e) =>
                      setCredential({ ...credential, alias: e.target.value })
                    }
                  />
                </label>
                <label>
                  账号
                  <input
                    value={credential.username}
                    autoComplete="off"
                    onChange={(e) =>
                      setCredential({ ...credential, username: e.target.value })
                    }
                  />
                </label>
                <label>
                  密码
                  <input
                    type="password"
                    value={credential.password}
                    autoComplete="new-password"
                    onChange={(e) =>
                      setCredential({ ...credential, password: e.target.value })
                    }
                  />
                </label>
              </div>
              <button
                className="secondary"
                disabled={busy || running}
                onClick={() =>
                  act(async () => {
                    const { id } = await api("credentials", "POST", credential);
                    setCredentialId(id);
                    setCredential({
                      ...credential,
                      alias: "",
                      username: "",
                      password: "",
                    });
                    await refresh();
                    setNotice("站点凭据已保存，可以返回操作台运行。");
                  })
                }
              >
                保存站点账号
              </button>
            </section>
          </div>
        )}
        {deleteTarget && (
          <DeleteDialog
            target={deleteTarget}
            allVersions={deleteAll}
            setAllVersions={setDeleteAll}
            busy={busy}
            onCancel={() => setDeleteTarget(null)}
            onDelete={() => void act(deleteWorkflow)}
          />
        )}
      </main>
    </div>
  );
}
