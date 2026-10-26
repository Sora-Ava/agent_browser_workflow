import type { ServerResponse } from "node:http";
import type { BrowserPort } from "./engine.ts";

export function parseLiveFrame(
  raw: string,
): { data: string; mime: "image/jpeg" } | null {
  try {
    const value = JSON.parse(raw);
    if (
      value.type !== "frame" ||
      typeof value.data !== "string" ||
      value.data.length > 2 * 1024 * 1024 ||
      !value.data.startsWith("/9j/") ||
      !/^[A-Za-z0-9+/=]+$/.test(value.data)
    )
      return null;
    return { data: value.data, mime: "image/jpeg" };
  } catch {
    return null;
  }
}
export class LiveFrames {
  private socket?: WebSocket;
  private pending?: Promise<void>;
  private clients = new Set<ServerResponse>();
  private last?: { data: string; mime: "image/jpeg" };
  private retry?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private started = false;
  mode: "live" | "snapshot" = "snapshot";
  constructor(private readonly browser: BrowserPort) {}
  private fallback() {
    this.last = undefined;
    this.mode = "snapshot";
    this.broadcast("mode", "snapshot");
  }
  private scheduleRetry() {
    if (!this.disposed && this.clients.size && !this.retry)
      this.retry = setTimeout(() => {
        this.retry = undefined;
        void this.start();
      }, 2000);
  }
  private broadcast(event: string, value: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const client of this.clients) {
      if (!client.destroyed && client.writableLength < 1024 * 1024)
        client.write(payload);
    }
  }
  subscribe(res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: mode\ndata: ${JSON.stringify(this.mode)}\n\n`);
    this.clients.add(res);
    if (this.started) void this.start();
    if (this.last && this.mode === "live")
      res.write(`event: frame\ndata: ${JSON.stringify(this.last)}\n\n`);
    const heartbeat = setInterval(() => {
      if (!res.destroyed && res.writableLength < 1024)
        res.write(": keepalive\n\n");
    }, 15000);
    heartbeat.unref();
    res.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }
  async start() {
    if (
      this.disposed ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    )
      return;
    this.started = true;
    if (this.pending) return this.pending;
    this.pending = this.connect().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async connect() {
    try {
      let info = await this.browser.command(["stream", "status"]);
      if (!info.enabled) {
        await this.browser.command(["stream", "enable"]);
        info = await this.browser.command(["stream", "status"]);
      }
      if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) {
        this.fallback();
        this.scheduleRetry();
        return;
      }
      if (this.disposed) return;
      const ws = new WebSocket(`ws://127.0.0.1:${info.port}/?maxFps=5`);
      this.socket = ws;
      ws.onmessage = (event) => {
        try {
          const status = JSON.parse(String(event.data));
          if (
            status.type === "status" &&
            (status.connected === false || status.screencasting === false)
          )
            this.fallback();
        } catch {
          /* Malformed messages are ignored. */
        }
        const frame = parseLiveFrame(String(event.data));
        if (frame) {
          this.last = frame;
          this.mode = "live";
          this.broadcast("frame", frame);
        }
      };
      const disconnected = () => {
        if (this.socket !== ws) return;
        this.fallback();
        this.socket = undefined;
        this.scheduleRetry();
      };
      ws.onerror = () => {
        ws.close();
        disconnected();
      };
      ws.onclose = disconnected;
    } catch {
      this.fallback();
      this.scheduleRetry();
    }
  }
  close() {
    this.disposed = true;
    clearTimeout(this.retry);
    this.socket?.close();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
