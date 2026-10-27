import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenLocal } from "./support/listen.ts";
import { Config } from "../server/config.ts";
import { explore, agentTools } from "../server/agent.ts";
import type { Browser } from "../server/browser.ts";

for (const dispatchFails of [false, true])
  test(
    dispatchFails
      ? "indexed dispatched failures are never retried or recorded"
      : "indexed exploration records durable locator and automatically refreshes after each action",
    async () => {
      assert.ok(agentTools.some((t) => t.function.name === "act_on"));
      const dir = await mkdtemp(join(tmpdir(), "abw-indexed-"));
      const requests: any[] = [];
      const commands: string[][] = [];
      const recorded: any[] = [];
      let observations = 0;
      const provider = createServer(async (req, res) => {
        let body = "";
        for await (const c of req) body += c;
        requests.push(JSON.parse(body));
        const first = requests.length === 1;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: `c${requests.length}`,
                      type: "function",
                      function: {
                        name: first ? "act_on" : "finish",
                        arguments: JSON.stringify(
                          first
                            ? { observationId: "obs1", index: 1, type: "click" }
                            : { name: "菜单", parameters: [] },
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
        });
        const browser = {
          observe: async () => ({
            observationId: `obs${++observations}`,
            elements: [{ index: 1, text: "菜单" }],
            snapshot: "菜单",
            targets: "[]",
          }),
          prepareIndexed: async (id: string, index: number) => {
            assert.equal(id, "obs1");
            assert.equal(index, 1);
            return {
              selector: '[data-abw-index="obs1:1"]',
              locator: 'element:{"tag":"DIV","role":"tab","name":"菜单"}',
            };
          },
          command: async (args: string[]) => {
            commands.push(args);
            if (dispatchFails)
              throw new Error("possibly dispatched click failed");
            return {};
          },
        } as unknown as Browser;
        const pending = explore(
          "点击菜单",
          "http://example.local",
          browser,
          config,
          {
            continueFromCurrent: true,
            signal: new AbortController().signal,
            onStep: async (step) => {
              recorded.push(step);
            },
            onModel: () => {},
          },
        );
        if (dispatchFails) {
          await assert.rejects(pending, /possibly dispatched/);
          assert.equal(commands.length, 1);
          assert.equal(recorded.length, 0);
          assert.equal(requests.length, 1);
          return;
        }
        const result = await pending;
        assert.equal(observations, 2);
        assert.deepEqual(commands, [["click", '[data-abw-index="obs1:1"]']]);
        assert.equal(result.draft?.steps[0].type, "click");
        assert.equal(
          (recorded[0] as any).selector.startsWith("element:"),
          true,
        );
        assert.equal(
          JSON.stringify(result.draft).includes("data-abw-index"),
          false,
        );
        assert.match(requests[1].messages.at(-1).content, /obs2/);
      } finally {
        await new Promise<void>((r) => provider.close(() => r()));
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
