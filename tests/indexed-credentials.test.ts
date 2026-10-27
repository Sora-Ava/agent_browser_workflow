import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listenLocal } from "./support/listen.ts";
import { explore } from "../server/agent.ts";
import { Config } from "../server/config.ts";
import type { Browser } from "../server/browser.ts";

test("indexed credential strings input saved values but record references without exposing secrets to model", async () => {
  const requests: any[] = [];
  const commands: string[][] = [];
  let observations = 0;
  const dir = await mkdtemp(join(tmpdir(), "abw-credential-"));
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requests.push(JSON.parse(body));
    const n = requests.length;
    const key = n === 1 ? "username" : "password";
    const args =
      n < 3
        ? {
            observationId: `obs${n}`,
            index: n,
            type: "fill",
            value: `{credential:"${key}"}`,
          }
        : { name: "登录输入", parameters: [] };
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
                  function: {
                    name: n < 3 ? "act_on" : "finish",
                    arguments: JSON.stringify(args),
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
        elements: [{ index: 1 }, { index: 2 }],
      }),
      prepareIndexed: async (_id: string, index: number) => ({
        selector: `#field${index}`,
        locator: `#field${index}`,
      }),
      command: async (args: string[]) => {
        commands.push(args);
        return args[0] === "get" ? { url: "https://example.local/login" } : {};
      },
    } as unknown as Browser;
    const result = await explore(
      "填写已保存凭据",
      "https://example.local/login",
      browser,
      config,
      {
        continueFromCurrent: true,
        credential: {
          origin: "https://example.local",
          username: "fictional-user-XYZ",
          password: "fictional-password-XYZ",
        },
        signal: new AbortController().signal,
        onStep: async () => {},
        onModel: () => {},
      },
    );
    assert.deepEqual(
      commands.filter((a) => a[0] === "fill"),
      [
        ["fill", "#field1", "fictional-user-XYZ"],
        ["fill", "#field2", "fictional-password-XYZ"],
      ],
    );
    assert.deepEqual(
      result.draft?.steps.map((s) => ("value" in s ? s.value : null)),
      [{ credential: "username" }, { credential: "password" }],
    );
    assert.equal(
      JSON.stringify([requests, result.draft]).includes(
        "fictional-password-XYZ",
      ),
      false,
    );
    assert.equal(
      JSON.stringify([requests, result.draft]).includes("fictional-user-XYZ"),
      false,
    );
  } finally {
    await new Promise<void>((r) => provider.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
