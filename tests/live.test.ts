import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveFrame, LiveFrames } from "../server/live.ts";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

test("only valid bounded JPEG messages can become live frames", () => {
  const jpeg = "/9j/AA==";
  assert.deepEqual(
    parseLiveFrame(JSON.stringify({ type: "frame", data: jpeg })),
    { data: jpeg, mime: "image/jpeg" },
  );
  assert.equal(parseLiveFrame("{bad json"), null);
  assert.equal(
    parseLiveFrame(JSON.stringify({ type: "status", data: jpeg })),
    null,
  );
  assert.equal(
    parseLiveFrame(JSON.stringify({ type: "frame", data: "<script>" })),
    null,
  );
  assert.equal(
    parseLiveFrame(
      JSON.stringify({ type: "frame", data: "A".repeat(3 * 1024 * 1024) }),
    ),
    null,
  );
});
test("native disconnected status clears live mode even when websocket remains open", async () => {
  const source = createServer();
  let peer: any;
  source.on("upgrade", (req, socket) => {
    peer = socket;
    socket.on("error", () => {});
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    const send = (v: unknown) => {
      const b = Buffer.from(JSON.stringify(v));
      socket.write(Buffer.concat([Buffer.from([0x81, b.length]), b]));
    };
    send({ type: "frame", data: "/9j/AA==" });
    setTimeout(
      () => send({ type: "status", connected: false, screencasting: false }),
      150,
    );
  });
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  const live = new LiveFrames({
    command: async () => ({
      enabled: true,
      port: (source.address() as any).port,
    }),
  });
  try {
    await live.start();
    for (let i = 0; i < 30 && live.mode !== "live"; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(live.mode, "live");
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(live.mode, "snapshot");
  } finally {
    live.close();
    peer?.destroy();
    await new Promise<void>((r) => source.close(() => r()));
  }
});
test("live frames reach HTTP subscribers and disconnected sockets fall back to snapshots", async () => {
  const source = createServer();
  const sockets = new Set<any>();
  source.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    const payload = Buffer.from(
      JSON.stringify({ type: "frame", data: "/9j/AA==" }),
    );
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    setTimeout(() => socket.destroy(), 150);
  });
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
  let attempts = 0;
  const live = new LiveFrames({
    command: async () => {
      if (attempts++ === 0) throw new Error("initial connection unavailable");
      return { enabled: true, port: (source.address() as any).port };
    },
  });
  const target = createServer((_req, res) => live.subscribe(res));
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const controller = new AbortController();
  try {
    await live.start();
    assert.equal(live.mode, "snapshot");
    const response = await fetch(
      `http://127.0.0.1:${(target.address() as any).port}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    await live.start();
    let text = "";
    const read = async () => {
      while (!text.includes("event: frame")) {
        const value = await reader.read();
        text += new TextDecoder().decode(value.value);
      }
    };
    await Promise.race([
      read(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("missing live frame")), 2000).unref(),
      ),
    ]);
    assert.ok(text.includes("/9j/AA=="));
    for (let i = 0; i < 30 && live.mode !== "snapshot"; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(live.mode, "snapshot");
  } finally {
    controller.abort();
    live.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => target.close(() => r()));
    await new Promise<void>((r) => source.close(() => r()));
  }
});
