import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../server/config.ts";
import { explore, agentTools } from "../server/agent.ts";
import type { Browser } from "../server/browser.ts";

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
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
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
