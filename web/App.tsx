import { useEffect, useState } from "react";
import type { Workflow, Step } from "../shared/workflow.ts";
import { demoWorkflow } from "../shared/demo-workflow.ts";

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

export function App() {
  const [view, setView] = useState("work");
  const [settings, setSettings] = useState<any>(null);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [state, setState] = useState<any>({ history: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startUrl, setStartUrl] = useState("http://127.0.0.1:3001/demo");
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [credential, setCredential] = useState({
    origin: "http://127.0.0.1:3001",
    alias: "",
    username: "",
    password: "",
  });
  const running = ["running", "pausing", "paused", "repairing"].includes(
    state.active?.status,
  );
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
    setDraft(state.active?.draft || null);
  }, [state.active?.id, state.active?.status]);
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
                <h1>{selected ? selected.name : "让浏览器，完成重复的事。"}</h1>
                <p>
                  {selected
                    ? "填写本次参数，复用已经保存的操作。"
                    : "描述一次，保存流程。下次只需换个参数。"}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => {
                  setSelected(null);
                  setDraft(null);
                  setInstruction("");
                }}
              >
                ＋ 新建任务
              </button>
            </div>
            <div className="workspace">
              <section className="control-panel">
                <div className="panel-title">
                  <span className="section-number">1</span>
                  <h2>{selected ? "运行参数" : "操作指令"}</h2>
                  <span className="muted">
                    {selected ? "无需模型" : "自然语言"}
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
                    <label>
                      起始网址
                      <input
                        value={startUrl}
                        onChange={(e) => setStartUrl(e.target.value)}
                        placeholder="https://你的内网系统"
                      />
                    </label>
                    <label>
                      你希望完成什么？
                      <textarea
                        rows={5}
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="登录产品系统，查询产品 A。有数据时导出文件，没有数据则结束。"
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
                      running || busy || (!selected && !instruction.trim())
                    }
                    onClick={() =>
                      act(async () => {
                        await api(
                          selected ? "replay" : "explore",
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
                        : "开始操作"}
                  </button>
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
                        {"selector" in s ? s.selector : ""}
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
                      <h2>浏览器准备就绪</h2>
                      <p>
                        输入网址和操作指令开始。
                        <br />
                        执行后，这里会显示独立浏览器的页面。
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
                  <h2>确认参数，保存这次操作</h2>
                  <p>
                    自动识别的参数可修改；未参数化的输入会保持首次执行时的值。
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
                {draft.parameters.map((p, i) => (
                  <div className="parameter-edit" key={i}>
                    <label>
                      参数显示名称
                      <input
                        value={p.label}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            parameters: draft.parameters.map((x, j) =>
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
                          setDraft({
                            ...draft,
                            parameters: draft.parameters.map((x, j) =>
                              j === i
                                ? { ...x, defaultValue: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act(saveDraft)}
                >
                  保存流程
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
                  <button
                    className="flow-row"
                    key={w.id}
                    onClick={() => choose(w)}
                  >
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
                    {r.kind === "explore" ? "自然语言操作" : "流程回放"}
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
      </main>
    </div>
  );
}
