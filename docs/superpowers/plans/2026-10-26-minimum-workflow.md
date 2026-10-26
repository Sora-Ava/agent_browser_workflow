# Minimum Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本机可运行的自然语言浏览器操作、参数确认保存和零模型回放最小闭环。

**Architecture:** React 工作台与 Node HTTP API；同一 agent-browser 适配器服务探索和确定性回放；SQLite 保存流程与事件。本轮实现顺序操作、基础无数据判断和导出，复杂自愈/版本编辑后续增量实现。

**Tech Stack:** TypeScript, React, Vite, Node 24 node:sqlite, Zod, agent-browser（固定 npm 版本）。

**Spec:** docs/superpowers/specs/2026-10-26-agent-browser-workflow-design.md

## Global Constraints
- 浏览器操作统一使用 agent-browser，不引入 Playwright API。
- 本机单用户，监听 127.0.0.1；明文配置仅本地保存。
- 普通回放不调用模型；分支与参数须确定性执行。
- 用户已授权开始最小实现及推送，直接在当前 checkout 的 feature 分支实施，不另建 worktree。

## Review Focus
- 缺失参数、未知动作与动态引用不能进入保存的流程。
- 下载完成必须得到证据，不能只凭点击成功。
- 查询等待完成前不能判断无数据。
- 密钥不返回浏览器或写进流程日志；跨源请求不能修改本机设置。
- 任务互斥、取消与重启不得重复执行动作。

### Task 1: 浏览器接口与工程运行
Files: package.json, tsconfig.json, vite.config.ts, server/browser.ts, scripts/browser-smoke.ts
Interfaces: Browser.command(args: string[]): Promise<unknown>, Browser.snapshot(), Browser.screenshot().
- [x] 固定依赖并安装，检查 CLI help、JSON、截图和下载接口。
- [x] 实现参数数组调用、超时、错误封装；以真实本地页面验证。

### Task 2: 流程与持久化
Files: shared/workflow.ts, server/engine.ts, server/store.ts, tests/workflow.test.ts
Interfaces: validateWorkflow(input), runWorkflow(workflow, values, browser, options), Store。
- [x] 先测试参数替换、无数据分支、拒绝动态引用/未知参数与取消。
- [x] 运行测试确认缺少模块而失败，随后实现验证、解释器与 SQLite。
- [x] 普通回放使用禁用模型的测试，确认仍执行并输出正确结果。

### Task 3: 探索 Agent 与 HTTP
Files: server/agent.ts, server/app.ts, server/config.ts, tests/api.test.ts
Interfaces: explore(instruction, startUrl), GET/PUT settings, POST explore/replay, GET state/workflows。
- [x] 先测试设置密钥遮挡、参数检查和单任务互斥。
- [x] 实现 OpenAI 兼容工具循环，工具仅受支持动作、按步骤截图、保存真实动作记录。
- [x] 完成参数草稿推断与用户确认；不将模拟模型当作真实自然语言能力验收。

### Task 4: 工作台与验收
Files: web/App.tsx, web/styles.css, README.md, scripts/integration.ts
- [x] 视觉方案：纸白 #F7F9FC、墨蓝 #172B4D、主蓝 #2055CD、青色 #147D73、浅蓝灰 #DDE5F0；正文 Segoe UI/微软雅黑，信息左对齐；画面为主体，侧栏表达真实步骤而非装饰卡片。
- [x] 构建工作台、设置、流程/参数表单、运行记录；窄屏上下堆叠，焦点可见。
- [x] 运行单元测试、类型检查、构建、真实浏览器端到端及 UI 截图检查。
- [x] 独立审阅本轮实现，修复重要问题；提交并推送 feature 分支为本轮收尾步骤。

## Execution ledger
- Browser compatibility: agent-browser 0.39.2 Windows native download command produced `Download was canceled` in real Chrome. Upstream handle_download canonicalizes the target to a Windows extended path. Add a narrow CDP download policy/event adapter through the endpoint returned by agent-browser; clicks and all other page actions stay on agent-browser. Must prove real completed files before claiming support.
- Verified Windows downloads require native backslash paths. Forward-slash paths still canceled after all bytes arrived; native backslash paths completed. Adapter also selects the active browser context. Unique per-export temporary directories prevent filename collision with failed exports.
- Review fixes: recursive value-only redaction preserves JSON structure for short passwords; final screenshot completes before terminal state/lock publication; full observations include hidden stable state containers. Regression tests were observed failing before fixes.
- UI review: desktop 1440×1000 and narrow 390×844 screenshots inspected; no JavaScript errors, no document horizontal overflow. Fixed narrow placeholder clipping caused by aspect ratio/min-height sizing.
- Verification: 12 unit/API/contract tests pass; TypeScript + Vite production build passes; npm audit reports 0 vulnerabilities; real browser smoke passes login, changed parameter, data/no_data, download, collision prevention and scripted model recording. No paid/real model configured or used.
- Ruling: 用户要求从最小实现开始，本轮复杂自动修复、新版本 diff、可视化编辑器不阻塞核心闭环，界面与 README 明示未实现项。
- Ruling: 复用当前干净 checkout，使用 feature 分支隔离；不创建额外 worktree。
