import { listenLocal } from "./support/listen.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../server/config.ts";
import { explore, agentTools } from "../server/agent.ts";
import type { Browser } from "../server/browser.ts";

test("missing click target is re-observed before dispatch and only the corrected click is recorded", async () => {
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push(JSON.parse(raw));
    const n = requests.length;
    const name = n < 3 ? "act" : "finish";
    const args =
      n < 3
        ? {
            step: {
              type: "click",
              selector:
                n === 1 ? 'input[name="direction"]' : "#direction-label",
            },
          }
        : { name: "追溯方向", parameters: [] };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: `c${n}`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await listenLocal(provider);
  const dir = await mkdtemp(join(tmpdir(), "abw-locator-"));
  const commands: string[][] = [];
  let observations = 0;
  try {
    const config = new Config(dir);
    await config.update({
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      model: "fixture",
      apiKey: "",
      downloadDir: dir,
    });
    const browser = {
      command: async (args: string[]) => {
        commands.push(args);
        return args[0] === "get"
          ? { count: args[2] === "#direction-label" ? 1 : 0 }
          : {};
      },
      observe: async () => {
        observations++;
        return {
          snapshot: "追溯方向",
          targets: '[{"selector":"#direction-label","text":"追溯方向"}]',
        };
      },
    } as unknown as Browser;
    const result = await explore(
      "点击追溯方向",
      "http://example.local",
      browser,
      config,
      {
        continueFromCurrent: true,
        signal: new AbortController().signal,
        onStep: async () => {},
        onModel: () => {},
      },
    );
    assert.deepEqual(
      commands.filter((c) => c[0] === "click"),
      [["click", "#direction-label"]],
    );
    assert.equal(observations, 2);
    assert.match(requests[1].messages.at(-1).content, /未执行/);
    assert.deepEqual(result.draft?.steps, [
      { type: "click", selector: "#direction-label" },
    ]);
  } finally {
    await new Promise<void>((r) => provider.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("model tools use object root schemas accepted by OpenAI compatible providers", () => {
  for (const tool of agentTools)
    assert.equal(tool.function.parameters.type, "object");
});
test("tool conversation produces a parameterized draft only from recorded actions", async () => {
  let turn = 0;
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push(JSON.parse(raw));
    const calls = [
      ["observe", {}],
      [
        "act",
        { step: { type: "fill", selector: "#product", value: "产品 A" } },
      ],
      [
        "finish",
        {
          name: "产品查询",
          parameters: [
            {
              name: "product",
              label: "产品",
              defaultValue: "产品 A",
              stepIndexes: [0],
            },
          ],
        },
      ],
    ];
    const [name, args] = calls[turn++];
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-" + turn,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await listenLocal(provider);
  const dir = await mkdtemp(join(tmpdir(), "abw-agent-"));
  const config = new Config(dir);
  try {
    await config.update({
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      model: "fake-contract-test",
      apiKey: "",
      downloadDir: dir,
    });
    // Only the external browser is replaced; gateway, schemas, recording and binding are real.
    const browser = {
      command: async () => ({}),
      observe: async () => ({ snapshot: "textbox Product", targets: "[]" }),
    } as unknown as Browser;
    const result = await explore(
      "查询产品 A",
      "http://example.local",
      browser,
      config,
      {
        signal: new AbortController().signal,
        onStep: async () => {},
        onModel: () => {},
      },
    );
    assert.ok(result.draft);
    assert.deepEqual(result.draft.steps, [
      { type: "fill", selector: "#product", value: { parameter: "product" } },
    ]);
    assert.equal(result.draft.parameters[0].defaultValue, "产品 A");
    assert.equal(requests[1].messages.at(-1).role, "tool");
  } finally {
    await new Promise<void>((r) => provider.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
