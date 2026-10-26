import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workflowSchema, type Workflow } from "../shared/workflow.ts";

export class Store {
  readonly db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "workflows.sqlite"));
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, created TEXT, body TEXT); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, body TEXT)",
    );
  }
  save(input: Workflow) {
    const body = workflowSchema.parse(input);
    const id = randomUUID();
    const created = new Date().toISOString();
    this.db
      .prepare("INSERT INTO workflows VALUES(?,?,?)")
      .run(id, created, JSON.stringify(body));
    return { id, created, ...body };
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM workflows ORDER BY created DESC")
        .all() as any[]
    ).map((r) => ({ id: r.id, created: r.created, ...JSON.parse(r.body) }));
  }
  get(id: string) {
    const row = this.db
      .prepare("SELECT body FROM workflows WHERE id=?")
      .get(id) as any;
    if (!row) throw new Error("流程不存在");
    return workflowSchema.parse(JSON.parse(row.body));
  }
  saveRun(run: any) {
    this.db
      .prepare("INSERT OR REPLACE INTO runs VALUES(?,?)")
      .run(run.id, JSON.stringify(run));
  }
  runs() {
    return (
      this.db
        .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 20")
        .all() as any[]
    ).map((r) => JSON.parse(r.body));
  }
}
