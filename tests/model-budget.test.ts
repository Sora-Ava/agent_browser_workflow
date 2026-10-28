import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../server/config.ts";
import { explore } from "../server/agent.ts";
import type { Browser } from "../server/browser.ts";
import { listenLocal } from "./support/listen.ts";
for (const invalid of [false, true])
  for (const limit of invalid ? [8] : [2, 8])
    test(
      invalid
        ? "invalid indexes allow only one recovery without dispatch"
        : `model calls stop at budget ${limit} or earlier without progress, with bounded context`,
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "abw-budget-"));
        let calls = 0;
        let prepares = 0;
        let observations = 0;
        const provider = createServer(async (req, res) => {
          let body = "";
          for await (const c of req) body += c;
          const request = JSON.parse(body);
          calls++;
          assert.ok(JSON.stringify(request.messages).length < 18000);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: `c${calls}`,
                        type: "function",
                        function: {
                          name: invalid ? "act_on" : "observe",
                          arguments: JSON.stringify(
                            invalid
                              ? {
                                  type: "click",
                                  observationId: "invented",
                                  index: 999,
                                }
                              : {},
                          ),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
        });
        await listenLocal(provider);
        try {
          const config = new Config(dir);
          await config.update({
            baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
            model: "fixture",
            apiKey: "",
            downloadDir: dir,
            maxModelCalls: limit,
          });
          const browser = {
            observe: async () => ({
              observationId: `o${++observations}`,
              elements: [{ index: 1, name: "按钮" }],
              snapshot: "x".repeat(30000),
            }),
            prepareIndexed: async () => {
              prepares++;
              throw new Error("should not prepare");
            },
            command: async () => assert.fail("must not dispatch"),
          } as unknown as Browser;
          await assert.rejects(
            explore("检查", "https://example.local", browser, config, {
              continueFromCurrent: true,
              signal: new AbortController().signal,
              onStep: async () => {},
              onModel: () => {},
            }),
            invalid
              ? /连续失效/
              : limit === 8
                ? /连续两次观察/
                : /2 次模型调用上限/,
          );
          assert.equal(calls, 2);
          assert.equal(prepares, 0);
        } finally {
          await new Promise<void>((r) => provider.close(() => r()));
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
