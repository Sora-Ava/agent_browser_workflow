import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const settingsSchema = z.object({
  baseUrl: z.url().refine((s) => /^https?:/.test(s)),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(4000),
  downloadDir: z.string().refine(isAbsolute, "下载目录必须为绝对路径"),
});
const credentialSchema = z.object({
  origin: z.url().refine((s) => /^https?:/.test(s)),
  alias: z.string().min(1).max(100),
  username: z.string().min(1).max(1000),
  password: z.string().min(1).max(4000),
});
type Settings = z.infer<typeof settingsSchema>;
type Credential = z.infer<typeof credentialSchema> & { id: string };
async function load(file: string, fallback: any) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export class Config {
  constructor(readonly dir: string) {}
  async read(): Promise<Settings> {
    return load(join(this.dir, "settings.json"), {
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      model: process.env.LLM_MODEL || "",
      apiKey: process.env.LLM_API_KEY || "",
      downloadDir: resolve("downloads"),
    });
  }
  async publicSettings() {
    const { apiKey, ...rest } = await this.read();
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }
  async update(input: unknown) {
    const next = settingsSchema.parse(input);
    const previous = await this.read();
    if (!next.apiKey) next.apiKey = previous.apiKey;
    await this.write("settings.json", next);
  }
  private async write(file: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, file),
      JSON.stringify(value, null, 2),
      "utf8",
    );
  }
  private async rawCredentials(): Promise<Credential[]> {
    return load(join(this.dir, "credentials.json"), []);
  }
  async credentials() {
    return (await this.rawCredentials()).map(
      ({ password, username, ...meta }) => meta,
    );
  }
  async saveCredential(input: unknown) {
    const c = credentialSchema.parse(input);
    const credentials = await this.rawCredentials();
    const id = randomUUID();
    credentials.push({ ...c, origin: new URL(c.origin).origin, id });
    await this.write("credentials.json", credentials);
    return id;
  }
  async credential(id: string) {
    const value = (await this.rawCredentials()).find((c) => c.id === id);
    if (!value) throw new Error("凭据不存在");
    return value;
  }
  async redact(text: string) {
    const secrets = [
      (await this.read()).apiKey,
      ...(await this.rawCredentials()).flatMap((c) => [c.username, c.password]),
    ]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const s of secrets) text = text.split(s).join("[已隐藏]");
    return text;
  }
  async redactValue(value: unknown): Promise<any> {
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value))
      return Promise.all(value.map((v) => this.redactValue(v)));
    if (value && typeof value === "object")
      return Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([key, v]) => [
            key,
            await this.redactValue(v),
          ]),
        ),
      );
    return value;
  }
}
