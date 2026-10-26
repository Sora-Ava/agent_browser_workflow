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
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS workflow_versions(id TEXT PRIMARY KEY,root_id TEXT NOT NULL,parent_id TEXT,version INTEGER NOT NULL)",
    );
    this.db.exec(
      "INSERT OR IGNORE INTO workflow_versions SELECT id,id,NULL,1 FROM workflows",
    );
  }
  save(input: Workflow) {
    const body = workflowSchema.parse(input);
    const id = randomUUID();
    const created = new Date().toISOString();
    this.db
      .prepare("INSERT INTO workflows VALUES(?,?,?)")
      .run(id, created, JSON.stringify(body));
    this.db
      .prepare("INSERT INTO workflow_versions VALUES(?,?,NULL,1)")
      .run(id, id);
    return { id, created, rootId: id, parentId: null, version: 1, ...body };
  }
  saveVersion(parentId: string, input: Workflow) {
    const parent = this.db
      .prepare("SELECT * FROM workflow_versions WHERE id=?")
      .get(parentId) as any;
    if (!parent) throw new Error("原流程版本不存在");
    const body = workflowSchema.parse(input);
    const id = randomUUID();
    const created = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT MAX(version) AS current FROM workflow_versions WHERE root_id=?",
        )
        .get(parent.root_id) as any;
      const version = row.current + 1;
      this.db
        .prepare("INSERT INTO workflows VALUES(?,?,?)")
        .run(id, created, JSON.stringify(body));
      this.db
        .prepare("INSERT INTO workflow_versions VALUES(?,?,?,?)")
        .run(id, parent.root_id, parentId, version);
      this.db.exec("COMMIT");
      return {
        id,
        created,
        rootId: parent.root_id,
        parentId,
        version,
        ...body,
      };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  list() {
    return (
      this.db
        .prepare(
          "SELECT w.*,v.root_id,v.parent_id,v.version FROM workflows w JOIN workflow_versions v ON w.id=v.id ORDER BY w.created DESC",
        )
        .all() as any[]
    ).map((r) => ({
      id: r.id,
      created: r.created,
      rootId: r.root_id,
      parentId: r.parent_id,
      version: r.version,
      ...JSON.parse(r.body),
    }));
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
