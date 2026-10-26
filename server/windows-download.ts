import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserPort } from "./engine.ts";

// agent-browser 0.39.2 canonicalizes Windows paths to \\?\ before passing
// them to Chrome. Chrome cancels these downloads. Use its own CDP endpoint
// for download policy/events only; all page interaction stays on the CLI.
export async function windowsDownload(
  browser: BrowserPort,
  selector: string,
  destination: string,
) {
  const { cdpUrl } = await browser.command(["get", "cdp-url"]);
  const { url: activeUrl } = await browser.command(["get", "url"]);
  const socket = new WebSocket(cdpUrl);
  let guid: string | undefined;
  let suggestedFilename: string | undefined;
  let resolveCompletion: () => void = () => {};
  let rejectCompletion: (e: Error) => void = () => {};
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // Attach a handler immediately, including if setup fails before awaiting completion.
  void completion.catch(() => {});
  const timer = setTimeout(
    () =>
      rejectCompletion(
        new Error("等待下载完成超时；请检查浏览器下载状态，勿重复点击导出"),
      ),
    120000,
  );
  try {
    await mkdir(dirname(destination), { recursive: true });
    await new Promise<void>((ok, fail) => {
      socket.onopen = () => ok();
      socket.onerror = () => fail(new Error("下载事件连接失败"));
    });
    const policy = new Promise<void>((ok, fail) => {
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1) {
          if (msg.error) {
            fail(new Error("无法识别下载浏览器上下文"));
            return;
          }
          const targets = msg.result.targetInfos.filter(
            (t: any) => t.type === "page" && t.url === activeUrl,
          );
          if (targets.length !== 1) {
            fail(new Error("下载目标不明确，请关闭多余标签页"));
            return;
          }
          socket.send(
            JSON.stringify({
              id: 2,
              method: "Browser.setDownloadBehavior",
              params: {
                behavior: "allow",
                downloadPath: dirname(destination),
                eventsEnabled: true,
                ...(targets[0].browserContextId
                  ? { browserContextId: targets[0].browserContextId }
                  : {}),
              },
            }),
          );
        }
        if (msg.id === 2) {
          if (msg.error) fail(new Error("无法配置下载目录"));
          else ok();
        }
        if (msg.method === "Browser.downloadWillBegin") {
          guid = msg.params.guid;
          suggestedFilename = msg.params.suggestedFilename;
        }
        if (
          msg.method === "Browser.downloadProgress" &&
          msg.params.guid === guid
        ) {
          if (msg.params.state === "completed") resolveCompletion();
          if (msg.params.state === "canceled")
            rejectCompletion(new Error("浏览器取消了文件下载"));
        }
      };
      socket.onclose = () => rejectCompletion(new Error("下载事件连接已断开"));
      socket.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
      setTimeout(() => fail(new Error("配置下载目录超时")), 10000).unref();
    });
    await policy;
    await browser.command(["click", selector]);
    await completion;
    if (!guid) throw new Error("没有收到下载标识");
    if (!suggestedFilename || /[\\/]/.test(suggestedFilename))
      throw new Error("下载文件名无效");
    const source = join(dirname(destination), suggestedFilename);
    for (let i = 0; i < 20; i++) {
      try {
        await stat(source);
        await rename(source, destination);
        return { path: destination };
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("下载已报告完成，但文件没有写入指定目录");
  } finally {
    clearTimeout(timer);
    socket.onclose = null;
    socket.close();
  }
}
