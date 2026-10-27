import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { windowsDownload } from "./windows-download.ts";
import { randomUUID } from "node:crypto";
import { parseTextLocator, resolveTextInPage } from "./text-locator.ts";
import { pageElements, parseElementLocator } from "./page-elements.ts";

const cli = resolve("node_modules/agent-browser/bin/agent-browser.js");
export class Browser {
  readonly session: string;
  constructor(
    readonly dataDir: string,
    session = "abw-local",
  ) {
    this.session = session;
  }
  async command(args: string[]): Promise<any> {
    // Persist semantic intent; resolve afresh on every execution, then use native
    // agent-browser actions for scrolling, hit testing and real input events.
    const index = ["click", "fill", "select", "wait", "download"].includes(
      args[0],
    )
      ? 1
      : ["get", "is"].includes(args[0])
        ? 2
        : -1;
    if (index >= 0 && args[index]?.startsWith("element:")) {
      const descriptor = parseElementLocator(args[index])!;
      const result = await this.elementOperation("resolve", {
        descriptor,
        token: randomUUID(),
      });
      if (args[0] === "get" && args[1] === "count")
        return { count: result.count };
      if (args[0] === "is" && result.count === 0) return { visible: false };
      if (result.count !== 1)
        throw new Error(
          `录制目标「${descriptor.name || descriptor.text || descriptor.tag}」匹配 ${result.count} 个元素，已停止以避免误操作`,
        );
      args = [...args];
      args[index] = result.selector;
    }
    if (index >= 0 && args[index]?.startsWith("text:")) {
      const locator = parseTextLocator(args[index])!;
      // tsx may insert its function-name helper in serialized function bodies.
      const resolved = await this.command([
        "eval",
        `(() => { const __name = (fn, name) => fn; return (${resolveTextInPage.toString()})(${JSON.stringify(locator)},${JSON.stringify(randomUUID())}); })()`,
      ]);
      const result =
        typeof resolved.result === "string"
          ? JSON.parse(resolved.result)
          : resolved.result;
      if (args[0] === "get" && args[1] === "count")
        return { count: result.count };
      if (args[0] === "is" && result.count === 0) return { visible: false };
      if (result.count !== 1)
        throw new Error(
          `文字「${locator.text}」匹配 ${result.count} 个目标，请补充角色或所在区域：${JSON.stringify(result.candidates)}`,
        );
      args = [...args];
      args[index] = result.selector;
    }
    if (process.platform === "win32" && args[0] === "download")
      return windowsDownload(this, args[1], args[2]);
    await mkdir(this.dataDir, { recursive: true });
    const chrome =
      process.env.BROWSER_EXECUTABLE ||
      (process.platform === "win32" &&
      existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
        ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
        : undefined);
    const launch = [
      "--session",
      this.session,
      "--json",
      "--profile",
      join(this.dataDir, "profile"),
    ];
    if (chrome) launch.push("--executable-path", chrome);
    if (process.env.BROWSER_HEADED !== "false") launch.push("--headed");
    return new Promise((ok, fail) => {
      execFile(
        process.execPath,
        [cli, ...launch, ...args],
        {
          timeout: args[0] === "download" ? 125000 : 40000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "30000" },
        },
        (error, stdout) => {
          let result: any;
          try {
            result = JSON.parse(stdout.trim());
          } catch {
            return fail(
              new Error(
                error
                  ? `浏览器命令失败：${error.code || "启动失败"}`
                  : "浏览器返回了无效 JSON",
              ),
            );
          }
          if (!result.success) {
            if (
              args[0] === "is" &&
              /Element not found/.test(result.error || "")
            )
              return ok({ visible: false });
            return fail(new Error(result.error || "浏览器操作失败"));
          }
          ok(result.data);
        },
      );
    });
  }
  async screenshot() {
    const file = join(this.dataDir, "viewport.png");
    await this.command(["screenshot", file]);
    return readFile(file);
  }
  private async elementOperation(
    op: "observe" | "prepare" | "resolve",
    arg: unknown,
  ) {
    const response = await this.command([
      "eval",
      `(() => { const __name = (fn, name) => fn; return (${pageElements.toString()})(${JSON.stringify(op)},${JSON.stringify(arg)}); })()`,
    ]);
    return typeof response.result === "string"
      ? JSON.parse(response.result)
      : response.result;
  }
  async prepareIndexed(id: string, index: number) {
    return this.elementOperation("prepare", { id, index, token: randomUUID() });
  }
  async observe() {
    const snapshot = await this.command(["snapshot"]);
    // Application-owned, read-only DOM inspection. The model cannot supply JavaScript.
    const targets = await this.command([
      "eval",
      `JSON.stringify(Array.from(document.querySelectorAll('[id],input,button,select,a,[role],[aria-live]')).filter(e=>!['SCRIPT','STYLE','LINK'].includes(e.tagName)).slice(0,150).map(e=>({tag:e.tagName,type:e.getAttribute('type'),role:e.getAttribute('role'),visible:!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'),text:(e.textContent||'').trim().slice(0,120),selector:e.id?'#'+CSS.escape(e.id):e.getAttribute('name')?e.tagName.toLowerCase()+'[name='+JSON.stringify(e.getAttribute('name'))+']':e.getAttribute('placeholder')?'[placeholder='+JSON.stringify(e.getAttribute('placeholder'))+']':null})))`,
    ]);
    const indexed = await this.elementOperation("observe", {
      id: randomUUID(),
    });
    // Put actionable numbered targets first so prompt size limits do not hide them.
    return { ...indexed, snapshot: snapshot.snapshot, targets: targets.result };
  }
}
