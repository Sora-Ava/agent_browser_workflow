import { mkdir, stat, copyFile, rm, mkdtemp } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  bindValue,
  normalizeCredentialReference,
  validateValues,
  type Workflow,
  type Step,
  workflowSchema,
} from "../shared/workflow.ts";
import { locatorKeys, applyLocatorPatch } from "./repair.ts";

export interface BrowserPort {
  command(args: string[]): Promise<any>;
}
export interface ExecutionOptions {
  signal: AbortSignal;
  onStep: (step: Step, index: number, output?: unknown) => Promise<void>;
  downloadDir?: string;
  tempDir?: string;
  credential?: { origin: string; username: string; password: string };
  checkpoint?: () => Promise<void>;
  onReady?: () => Promise<void>;
  repairStep?: (step: Step, error: string, index: number) => Promise<Step>;
  onRepair?: (
    index: number,
    before: Step,
    after: Step,
    attempt: number,
  ) => Promise<void>;
}
export async function executeStep(
  step: Step,
  values: Record<string, string>,
  browser: BrowserPort,
  opts: ExecutionOptions,
): Promise<any> {
  opts.signal.throwIfAborted();
  switch (step.type) {
    case "login": {
      if (
        (await browser.command(["is", "visible", step.successSelector])).visible
      )
        return { alreadyLoggedIn: true };
      const current = await browser.command(["get", "url"]);
      if (
        !opts.credential ||
        new URL(current.url).origin !== opts.credential.origin
      )
        throw new Error("请为当前站点选择正确的凭据");
      await browser.command([
        "fill",
        step.usernameSelector,
        opts.credential.username,
      ]);
      opts.signal.throwIfAborted();
      await browser.command([
        "fill",
        step.passwordSelector,
        opts.credential.password,
      ]);
      opts.signal.throwIfAborted();
      await browser.command(["click", step.submitSelector]);
      await browser.command(["wait", step.successSelector]);
      return { loggedIn: true };
    }
    case "navigate":
      return browser.command(["open", step.url]);
    case "click":
      return browser.command(["click", step.selector]);
    case "fill":
    case "select": {
      const value = normalizeCredentialReference(
        step.value,
      ) as typeof step.value;
      if (typeof value === "object" && "credential" in value) {
        const current = await browser.command(["get", "url"]);
        if (
          !opts.credential ||
          new URL(current.url).origin !== opts.credential.origin
        )
          throw new Error("当前网址与凭据站点不一致");
      }
      return browser.command([
        step.type,
        step.selector,
        bindValue(value, values, opts.credential),
      ]);
    }
    case "press":
      return browser.command(["press", step.key]);
    case "wait":
      return browser.command(["wait", step.selector]);
    case "checkResults": {
      // Both explicit states are checked; missing/ambiguous states never mean no_data.
      const empty = (
        await browser.command(["is", "visible", step.emptySelector])
      ).visible;
      const data = (await browser.command(["is", "visible", step.dataSelector]))
        .visible;
      if (empty && !data) return { noData: true };
      if (data && !empty) return { noData: false };
      throw new Error(
        "查询状态不明确：应先等待查询完成，并提供互斥的有数据/无数据定位",
      );
    }
    case "extract":
      return browser.command(["get", "text", step.selector]);
    case "download": {
      if (!opts.downloadDir || !isAbsolute(opts.downloadDir))
        throw new Error("请选择本机绝对下载目录");
      const root = opts.tempDir || join(opts.downloadDir, ".pending");
      await mkdir(root, { recursive: true });
      await mkdir(opts.downloadDir, { recursive: true });
      const tmp = await mkdtemp(join(root, "export-"));
      const tempFile = join(tmp, `${randomUUID()}-${step.filename}`);
      await browser.command(["download", step.selector, tempFile]);
      const info = await stat(tempFile);
      if (!info.isFile()) throw new Error("未确认下载完成");
      let finalPath = join(opts.downloadDir, step.filename);
      try {
        await copyFile(tempFile, finalPath, constants.COPYFILE_EXCL);
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        finalPath = join(
          opts.downloadDir,
          `${Date.now()}-${randomUUID().slice(0, 8)}-${step.filename}`,
        );
        await copyFile(tempFile, finalPath, constants.COPYFILE_EXCL);
      }
      await rm(tmp, { recursive: true });
      return { path: finalPath, bytes: info.size };
    }
  }
}
export async function runWorkflow(
  workflow: Workflow,
  values: Record<string, string>,
  browser: BrowserPort,
  opts: ExecutionOptions,
) {
  validateValues(workflow, values);
  opts.signal.throwIfAborted();
  await browser.command(["open", workflow.startUrl]);
  await opts.onReady?.();
  const current = structuredClone(workflow);
  let repairs = 0;
  const outputs: unknown[] = [];
  for (const [index] of current.steps.entries()) {
    let step = current.steps[index];
    opts.signal.throwIfAborted();
    let result: any;
    while (true) {
      await opts.checkpoint?.();
      opts.signal.throwIfAborted();
      let dispatched = false;
      try {
        // Preflight is only added when automatic repair is enabled. Existing
        // workflows use the same schema and normal replay still needs no model.
        if (opts.repairStep) {
          let selectors =
            "selector" in step && step.type !== "wait" ? [step.selector] : [];
          if (
            step.type === "login" &&
            !(await browser.command(["is", "visible", step.successSelector]))
              .visible
          )
            selectors = [
              step.usernameSelector,
              step.passwordSelector,
              step.submitSelector,
            ];
          for (const selector of selectors) {
            const found = await browser.command(["get", "count", selector]);
            if (found.count !== 1)
              throw new Error(`定位匹配 ${found.count} 个元素：${selector}`);
          }
        }
        dispatched = true;
        result = await executeStep(step, values, browser, opts);
        break;
      } catch (error: any) {
        opts.signal.throwIfAborted();
        const readOnly =
          step.type === "wait" ||
          step.type === "extract" ||
          step.type === "checkResults";
        if (!opts.repairStep || (dispatched && !readOnly)) throw error;
        if (repairs >= 2)
          throw new Error("自动修复已达到两次上限，请检查页面和流程");
        repairs++;
        const proposal = await opts.repairStep(step, error.message, index);
        // Enforce the same narrow patch contract even for alternate providers.
        for (const [key, value] of Object.entries(proposal))
          if (
            !locatorKeys.includes(key as any) &&
            JSON.stringify(value) !== JSON.stringify((step as any)[key])
          )
            throw new Error("修复不得改变动作或参数");
        const patch = Object.fromEntries(
          Object.entries(proposal).filter(([key]) =>
            locatorKeys.includes(key as any),
          ),
        );
        const repaired = applyLocatorPatch(step, patch);
        const before = step;
        step = repaired;
        current.steps[index] = repaired;
        await opts.onRepair?.(index, before, repaired, repairs);
      }
    }
    outputs.push(result);
    await opts.onStep(step, index, result);
    if (result?.noData)
      return {
        status: "no_data" as const,
        outputs,
        repairs,
        repairedWorkflow: repairs ? workflowSchema.parse(current) : undefined,
      };
  }
  opts.signal.throwIfAborted();
  return {
    status: "succeeded" as const,
    outputs,
    repairs,
    repairedWorkflow: repairs ? workflowSchema.parse(current) : undefined,
  };
}
