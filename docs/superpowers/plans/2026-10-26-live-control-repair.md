# Live Control and Repair Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved-design increment in this session.

**Goal:** 在已验收的最小闭环上增加连续实时画面、暂停/继续和有边界的自动修复，并保留原流程版本。

**Architecture:** 转发 agent-browser 原生 JPEG 流到本机 SSE；任务在浏览器命令边界检查暂停状态。回放先检查稳定定位，定位失效且尚未执行动作时调用模型提出定位补丁；成功后保存新版本，不覆盖旧版本。

**Spec:** ../specs/2026-10-26-agent-browser-workflow-design.md

## Constraints / decisions
- 复用当前 checkout 和 feature 分支；不更改已保存流程 JSON 的基本格式。
- 正常运行仍为零模型调用；最多两轮定位修复。模型不能修改动作类型、值、参数、凭据或目标 URL。
- 点击、登录提交、下载已发出后的不明失败不自动重试，保留记录等待用户处理。
- 原生实时流连接失败时自动退化为步骤截图；界面标明当前模式。
- 暂停在当前命令结束后生效，继续前重新读取状态；暂停期间继续显示页面。
- 保留旧版流程，修复成功产生同一流程系列的新版本；用户可选择任一版本。

## Tasks
1. tests/control.test.ts → server/control.ts：先验证暂停阻止后续命令、继续放行、停止解除等待；浏览器与模型调用都经过任务边界。
2. tests/live.test.ts → server/live.ts：测试 JPEG 帧转发、坏消息拒绝、断线退化、连接释放；真实 Chrome 验证非步骤期间画面也更新。
3. tests/repair.test.ts → server/repair.ts, server/engine.ts：先验证修改定位而保持参数/凭据、修复上限、成功步骤不重放、动作发出后不重试。
4. tests/store.test.ts → server/store.ts：旧库兼容与版本历史，失败不生成版本。
5. server/app.ts, server/agent.ts, web/App.tsx, web/styles.css：接入 SSE、任务控制、状态、版本选择与修复记录，沿用 frontend-design 的现有布局。
6. 完整测试、真实浏览器集成、界面截图、独立审阅与推送；不读取或使用用户已保存的真实模型密钥做测试。

## Execution ledger
- 当前最小版本已由用户验收；本轮属于已批准完整设计的后续实现，无需重新等待方案确认。
- 已完成任务 1–5：原生 JPEG → SSE 实时画面、断线退化/重新订阅恢复、暂停/继续/取消、最多两轮定位修复、成功版本保存及界面选择。
- 独立审阅发现并修复：继续读取页面时再次暂停的竞态；取消发生在最终截图期间时误保存版本；原生 WebSocket 仍开着但浏览器断开时旧帧误标实时。对应回归测试先失败后通过。
- 25 项测试及 TypeScript/Vite 构建通过；旧数据库升级保留原 ID、流程内容并标为版本 1；依赖审计为 0。
- 真实 Chrome test:browser 验证原有登录、参数替换、无数据结束、下载和录制；test:control 验证无步骤期间与暂停期间持续帧、继续执行、脚本模型修复生成版本 2、下次零模型回放。两组集成均通过。
- 已检查暂停与版本选择的桌面截图。界面流程列表进入时主动刷新，避免快速连续运行后显示过期版本。
- 所有模型验证使用临时脚本合约服务，不读取或调用用户保存的真实模型密钥。未对真实模型的定位修复成功率做评估。
