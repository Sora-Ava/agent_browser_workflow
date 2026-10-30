import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Config } from "./config.ts";
import { Store } from "./store.ts";
import { Browser } from "./browser.ts";
import { explore } from "./agent.ts";
import { runWorkflow, executeStep } from "./engine.ts";
import { pickerPage } from "./picker.ts";
import {
  workflowSchema,
  validateValues,
  type Step,
} from "../shared/workflow.ts";
import { demoPage } from "./demo.ts";
import { RunControl } from "./control.ts";
import { LiveFrames } from "./live.ts";
import { repairLocator } from "./repair.ts";
import { Conversation } from "./conversation.ts";

async function body(req: IncomingMessage) {
  let content = "";
  for await (const chunk of req) {
    content += chunk;
    if (content.length > 256000) throw new Error("请求超过大小限制");
  }
  return JSON.parse(content || "{}");
}
const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const startSchema = z.object({
  instruction: z.string().min(1).max(10000),
  startUrl: z.url().refine((s) => /^https?:/.test(s)),
  credentialId: z.string().optional(),
});
const replaySchema = z.object({
  id: z.string().uuid(),
  values: z.record(z.string(), z.string()),
  credentialId: z.string().optional(),
});

export function createApp(dataDir = resolve("data"), session = "abw-local") {
  const config = new Config(dataDir),
    store = new Store(dataDir),
    browser = new Browser(dataDir, session);
  let active: any = null;
  let controller: RunControl | undefined;
  let manualBusy = false;
  let pickerTarget: { workflowId: string; index: number } | null = null;
  const live = new LiveFrames(browser);
  const conversation = new Conversation(store.conversation());
  const browserState: {
    status: "stopped" | "starting" | "ready" | "error";
    url?: string;
    error?: string;
  } = { status: "stopped" };
  let frame: Buffer | undefined;
  let frameVersion = 0;
  for (const run of store.runs())
    if (["running", "paused", "pausing", "repairing"].includes(run.status)) {
      run.status = "interrupted";
      store.saveRun(run);
    }
  async function capture() {
    try {
      frame = await browser.screenshot();
      frameVersion++;
    } catch {
      /* Screenshot is observational, never changes task success. */
    }
  }
  async function perform(
    kind: string,
    task: (
      signal: AbortSignal,
      onStep: (s: Step, i: number, output?: unknown) => Promise<void>,
    ) => Promise<any>,
  ) {
    const run = {
      id: randomUUID(),
      kind,
      status: "running",
      started: new Date().toISOString(),
      events: [] as any[],
      modelCalls: 0,
    };
    active = run;
    controller = new RunControl(
      (state) => {
        run.status = state;
        store.saveRun(run);
      },
      async () => {
        await browser.observe();
      },
    );
    const localController = controller;
    store.saveRun(run);
    void (async () => {
      let outcome: any;
      try {
        const result = await task(
          localController.signal,
          async (step, index, output) => {
            localController.signal.throwIfAborted();
            run.events.push(
              await config.redactValue({
                index,
                step,
                output,
                time: new Date().toISOString(),
              }),
            );
            store.saveRun(run);
            await capture();
          },
        );
        localController.signal.throwIfAborted();
        outcome = result;
      } catch (e: any) {
        outcome = {
          status: localController.signal.aborted ? "cancelled" : "failed",
          error: await config.redact(e.message || "运行失败"),
        };
      } finally {
        await capture();
        if (localController.signal.aborted) outcome = { status: "cancelled" };
        const { repairedWorkflow, ...visibleOutcome } = outcome;
        if (kind === "chat") {
          const summary =
            visibleOutcome.summary ||
            visibleOutcome.error ||
            (visibleOutcome.status === "cancelled"
              ? "本条指令已停止，等待下一条指令。"
              : "等待下一条指令。");
          conversation.complete(
            (run as any).instruction || "",
            summary,
            visibleOutcome.draft || null,
          );
          store.saveConversation(conversation.state());
          visibleOutcome.draft = conversation.state().draft;
          visibleOutcome.summary = summary;
        }
        if (
          repairedWorkflow &&
          ["succeeded", "no_data"].includes(visibleOutcome.status)
        ) {
          try {
            const version = store.saveVersion(
              visibleOutcome.workflowId,
              repairedWorkflow,
            );
            Object.assign(visibleOutcome, {
              repairedVersionId: version.id,
              repairedVersion: version.version,
            });
          } catch {
            Object.assign(visibleOutcome, {
              status: "failed",
              error: "本次操作已执行，但修复版本保存失败，请检查本机存储。",
            });
          }
        }
        Object.assign(run, visibleOutcome, {
          finished: new Date().toISOString(),
        });
        store.saveRun(run);
        controller = undefined;
      }
    })().catch(() => {
      Object.assign(run, {
        status: "failed",
        error: "任务记录整理失败，已执行步骤仍保留；可以新建会话后继续。",
        finished: new Date().toISOString(),
      });
      controller = undefined;
      try {
        store.saveRun(run);
      } catch {
        /* Keep failure visible in memory if storage is unavailable. */
      }
    });
    return run.id;
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        send(res, 403, { error: "仅允许本机访问" });
        return;
      }
      const origin = req.headers.origin;
      if (
        origin &&
        !new Set([
          `http://${host}`,
          "http://127.0.0.1:5173",
          "http://localhost:5173",
        ]).has(origin)
      ) {
        send(res, 403, { error: "不允许跨站访问" });
        return;
      }
      const path = new URL(req.url || "/", "http://localhost").pathname;
      if (path === "/demo") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(demoPage);
        return;
      }
      if (path === "/demo/export") {
        const product =
          new URL(req.url!, "http://localhost").searchParams.get("product") ||
          "";
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="products.csv"',
        });
        res.end(
          "\uFEFF产品,编号,库存\n" +
            product.replaceAll(/[\r\n,"]/g, "") +
            ",P-2026,128",
        );
        return;
      }
      if (path === "/api/state" && req.method === "GET") {
        send(res, 200, {
          active,
          history: store.runs(),
          frameVersion,
          captureMode: live.mode,
          browser: browserState,
          conversation: conversation.state(),
        });
        return;
      }
      if (path === "/api/live" && req.method === "GET") {
        live.subscribe(res);
        return;
      }
      if (path === "/api/browser/start" && req.method === "POST") {
        const input = z
          .object({
            url: z
              .string()
              .refine(
                (s) => s === "about:blank" || /^https?:\/\//.test(s),
                "请输入 http/https 网址",
              )
              .optional(),
          })
          .parse(await body(req));
        if (
          controller ||
          manualBusy ||
          pickerTarget ||
          browserState.status === "starting"
        ) {
          send(res, 409, { error: "已有任务或浏览器正在启动" });
          return;
        }
        browserState.status = "starting";
        delete browserState.error;
        try {
          const opened = await browser.command(
            input.url ? ["open", input.url] : ["open"],
          );
          browserState.url = opened.url || input.url || "about:blank";
          conversation.begin(browserState.url!);
          store.saveConversation(conversation.state());
          await live.start();
          await capture();
          browserState.status = "ready";
          send(res, 200, browserState);
        } catch (e: any) {
          browserState.status = "error";
          browserState.error = await config.redact(e.message);
          send(res, 400, { error: browserState.error });
        }
        return;
      }
      if (path === "/api/conversation/reset" && req.method === "POST") {
        if (
          controller ||
          manualBusy ||
          pickerTarget ||
          browserState.status === "starting"
        ) {
          send(res, 409, { error: "请先停止当前任务再新建会话" });
          return;
        }
        conversation.reset();
        store.saveConversation(conversation.state());
        send(res, 200, conversation.state());
        return;
      }
      if (path === "/api/frame" && req.method === "GET") {
        if (!frame) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-store",
        });
        res.end(frame);
        return;
      }
      if (path === "/api/settings" && req.method === "GET") {
        send(res, 200, await config.publicSettings());
        return;
      }
      if (path === "/api/settings" && req.method === "PUT") {
        await config.update(await body(req));
        send(res, 200, await config.publicSettings());
        return;
      }
      if (path === "/api/credentials" && req.method === "GET") {
        send(res, 200, await config.credentials());
        return;
      }
      if (path === "/api/credentials" && req.method === "POST") {
        if (controller || manualBusy || pickerTarget) {
          send(res, 409, { error: "运行时不能修改凭据" });
          return;
        }
        send(res, 201, { id: await config.saveCredential(await body(req)) });
        return;
      }
      if (path === "/api/workflows" && req.method === "GET") {
        send(res, 200, store.list());
        return;
      }
      if (path.startsWith("/api/manual/") && req.method === "POST") {
        if (controller || manualBusy || browserState.status !== "ready") {
          send(res, 409, { error: "请先启动浏览器，并等待当前任务完成" });
          return;
        }
        manualBusy = true;
        try {
          const input = (await body(req)) as any;
          if (path === "/api/manual/start") {
            const workflowId = z.uuid().parse(input.workflowId);
            const flow = store.get(workflowId);
            const index = z
              .number()
              .int()
              .min(0)
              .max(flow.steps.length - 1)
              .parse(input.index);
            if (!("selector" in flow.steps[index]))
              throw new Error("此步骤没有单一目标");
            await browser.observe(true);
            await browser.command([
              "eval",
              `(() => {const __name=(f,n)=>f;return (${pickerPage.toString()})("start")})()`,
            ]);
            pickerTarget = { workflowId, index };
            send(res, 200, { ok: true });
            return;
          }
          if (path === "/api/manual/cancel") {
            await browser.command([
              "eval",
              `(() => {const __name=(f,n)=>f;return (${pickerPage.toString()})("cancel")})()`,
            ]);
            pickerTarget = null;
            send(res, 200, { ok: true });
            return;
          }
          const flow = store.get(z.uuid().parse(input.workflowId));
          const index = z
            .number()
            .int()
            .min(0)
            .max(flow.steps.length - 1)
            .parse(input.index);
          const step = flow.steps[index];
          if (path === "/api/manual/replace") {
            if (
              pickerTarget?.workflowId !== input.workflowId ||
              pickerTarget?.index !== index
            )
              throw new Error("请先为本步骤启动元素选择");
            if (!("selector" in step))
              throw new Error("此步骤没有可替换的单一目标");
            const picked = await browser.command([
              "eval",
              `(() => {const __name=(f,n)=>f;return (${pickerPage.toString()})("status")})()`,
            ]);
            if (!picked.result) throw new Error("请先到浏览器点击选择一个元素");
            const prepared = await browser.prepareIndexed(
              picked.result.observationId,
              picked.result.index,
            );
            await browser.command([
              "eval",
              `(() => {const __name=(f,n)=>f;return (${pickerPage.toString()})("cancel")})()`,
            ]);
            step.selector = prepared.locator;
            pickerTarget = null;
            send(
              res,
              200,
              store.saveVersion(input.workflowId, workflowSchema.parse(flow)),
            );
            return;
          }
          if (path === "/api/manual/test") {
            if (pickerTarget) throw new Error("请先确认或取消元素选择");
            const credential = input.credentialId
              ? await config.credential(z.uuid().parse(input.credentialId))
              : undefined;
            const values = z
              .record(z.string(), z.string())
              .parse(input.values || {});
            perform("step-test", async (signal, onStep) => {
              const output = await executeStep(step, values, browser, {
                signal,
                onStep,
                credential,
                downloadDir: (await config.read()).downloadDir,
              });
              await onStep(step, index, output);
              return { status: "succeeded", output };
            });
            send(res, 202, { ok: true });
            return;
          }
          throw new Error("不支持的手动操作");
        } finally {
          manualBusy = false;
        }
      }
      if (path === "/api/workflows" && req.method === "POST") {
        send(res, 201, store.save(workflowSchema.parse(await body(req))));
        return;
      }
      if (path.startsWith("/api/workflows/") && req.method === "DELETE") {
        if (controller || manualBusy || pickerTarget) {
          send(res, 409, { error: "运行期间不能删除流程" });
          return;
        }
        const id = z
          .uuid()
          .parse(decodeURIComponent(path.slice("/api/workflows/".length)));
        const count = store.deleteWorkflow(
          id,
          new URL(req.url!, "http://localhost").searchParams.get(
            "allVersions",
          ) === "true",
        );
        send(res, 200, { deleted: count });
        return;
      }
      if (path === "/api/cancel" && req.method === "POST") {
        controller?.cancel();
        send(res, 200, { ok: true });
        return;
      }
      if (
        (path === "/api/pause" || path === "/api/resume") &&
        req.method === "POST"
      ) {
        if (!controller) {
          send(res, 409, { error: "当前没有运行中的任务" });
          return;
        }
        if (path === "/api/pause") controller.pause();
        else controller.resume();
        send(res, 200, { ok: true });
        return;
      }
      if (
        (path === "/api/explore" ||
          path === "/api/replay" ||
          path === "/api/chat") &&
        req.method === "POST"
      ) {
        if (controller || manualBusy || pickerTarget) {
          send(res, 409, { error: "已有任务正在运行" });
          return;
        }
        const input =
          path === "/api/chat"
            ? z
                .object({
                  instruction: z.string().trim().min(1).max(10000),
                  credentialId: z.string().optional(),
                })
                .parse(await body(req))
            : path === "/api/explore"
              ? startSchema.parse(await body(req))
              : replaySchema.parse(await body(req));
        if (browserState.status !== "ready") {
          send(res, 409, { error: "请先点击“启动浏览器”" });
          return;
        }
        const credential = input.credentialId
          ? await config.credential(input.credentialId)
          : undefined;
        const settings = await config.read();
        await mkdir(settings.downloadDir, { recursive: true });
        const replay = "id" in input ? store.get(input.id) : undefined;
        if (replay && "values" in input) validateValues(replay, input.values);
        if (credential && path !== "/api/chat") {
          const url =
            replay?.startUrl ||
            ("startUrl" in input && typeof input.startUrl === "string"
              ? input.startUrl
              : "");
          if (new URL(url).origin !== credential.origin)
            throw new Error("起始网址与凭据站点不一致");
        }
        // Reserve the single-run lock before any further await.
        if (
          controller ||
          manualBusy ||
          pickerTarget ||
          browserState.status !== "ready"
        ) {
          send(res, 409, {
            error: controller ? "已有任务正在运行" : "浏览器尚未启动完成",
          });
          return;
        }
        const id = await perform(
          path === "/api/chat"
            ? "chat"
            : path === "/api/explore"
              ? "explore"
              : "replay",
          async (signal, onStep) => {
            active.startUrl =
              replay?.startUrl ||
              ("startUrl" in input ? input.startUrl : undefined);
            active.workflowName = replay?.name;
            const control = controller!;
            const controlledBrowser = new Proxy(browser, {
              get(target, property, receiver) {
                if (property === "command")
                  return async (args: string[]) => {
                    await control.checkpoint();
                    return target.command(args);
                  };
                return Reflect.get(target, property, receiver);
              },
            });
            const opts = {
              signal,
              onStep,
              credential,
              downloadDir: settings.downloadDir,
              tempDir: join(dataDir, "pending"),
              checkpoint: () => control.checkpoint(),
              onReady: () => live.start(),
            };
            if (path === "/api/chat" && "instruction" in input) {
              const previous = conversation.state();
              const safeInstruction = await config.redact(input.instruction);
              active.instruction = safeInstruction;
              conversation.beginTurn(safeInstruction);
              store.saveConversation(conversation.state());
              const location = await controlledBrowser.command(["get", "url"]);
              conversation.begin(
                location.url || browserState.url || "about:blank",
              );
              const result = await explore(
                input.instruction,
                conversation.state().startUrl || location.url || "about:blank",
                controlledBrowser,
                config,
                {
                  ...opts,
                  continueFromCurrent: true,
                  initialSteps: previous.steps,
                  history: previous.messages,
                  onStep: async (step, index, output) => {
                    conversation.record(step);
                    store.saveConversation(conversation.state());
                    await onStep(step, index, output);
                  },
                  onModel: () => {
                    active.modelCalls++;
                  },
                },
              );
              const current = await controlledBrowser.command(["get", "url"]);
              browserState.url = current.url || browserState.url;
              active.startUrl = browserState.url;
              return result;
            }
            if ("instruction" in input)
              return explore(
                input.instruction,
                "startUrl" in input && typeof input.startUrl === "string"
                  ? input.startUrl
                  : browserState.url || "about:blank",
                controlledBrowser,
                config,
                {
                  ...opts,
                  onModel: () => {
                    active.modelCalls++;
                  },
                },
              );
            const result = await runWorkflow(
              replay!,
              input.values,
              controlledBrowser,
              {
                ...opts,
                repairStep: async (step, error, index) => {
                  await control.checkpoint();
                  active.status = "repairing";
                  active.repairingStep = index;
                  store.saveRun(active);
                  try {
                    return await repairLocator(
                      step,
                      error,
                      controlledBrowser,
                      config,
                      signal,
                      () => {
                        active.modelCalls++;
                      },
                    );
                  } finally {
                    if (!["paused", "pausing"].includes(control.status))
                      active.status = "running";
                  }
                },
                onRepair: async (index, before, after, attempt) => {
                  active.repairLog ??= [];
                  active.repairLog.push(
                    await config.redactValue({ index, before, after, attempt }),
                  );
                  store.saveRun(active);
                },
              },
            );
            return { ...result, workflowId: input.id };
          },
        );
        send(res, 202, { id });
        return;
      }
      if (path.startsWith("/api/")) {
        send(res, 404, { error: "接口不存在" });
        return;
      }
      const dist = resolve("dist");
      const file =
        path === "/"
          ? join(dist, "index.html")
          : resolve(dist, "." + decodeURIComponent(path));
      if (
        file !== dist &&
        !file.startsWith(dist + (process.platform === "win32" ? "\\" : "/"))
      ) {
        send(res, 403, { error: "路径无效" });
        return;
      }
      try {
        const bytes = await readFile(file);
        res.writeHead(200, {
          "content-type":
            (
              {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
              } as any
            )[extname(file)] || "application/octet-stream",
        });
        res.end(bytes);
      } catch {
        send(res, 404, { error: "请先 npm run build，或使用 npm run dev" });
      }
    } catch (e: any) {
      send(res, 400, {
        error: await config.redact(
          e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join("；")
            : e.message || "请求失败",
        ),
      });
    }
  });
  server.once("close", () => live.close());
  return { server, store, browser, config, live };
}
