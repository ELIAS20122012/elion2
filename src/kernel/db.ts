// SQLite is the single source of truth. Uses Node's built-in node:sqlite (no native build step on Windows).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS: string[] = [
  // v1 — kernel core
  `
  CREATE TABLE tasks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    provider      TEXT NOT NULL,
    status        TEXT NOT NULL,
    capabilities  TEXT NOT NULL DEFAULT '[]',
    verify        TEXT NOT NULL DEFAULT '{"type":"non_empty"}',
    priority      INTEGER NOT NULL DEFAULT 0,
    attempts      INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 3,
    timeout_ms    INTEGER NOT NULL DEFAULT 600000,
    result        TEXT,
    error         TEXT,
    failure_kind  TEXT,
    source        TEXT NOT NULL DEFAULT 'manual',
    schedule_id   TEXT,
    parent_id     TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    not_before    TEXT
  );
  CREATE INDEX idx_tasks_queue ON tasks(status, priority DESC, created_at);

  CREATE TABLE runs (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES tasks(id),
    attempt       INTEGER NOT NULL,
    provider      TEXT NOT NULL,
    status        TEXT NOT NULL,
    output        TEXT,
    error         TEXT,
    failure_kind  TEXT,
    feedback      TEXT,
    cost_usd      REAL,
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_ms   INTEGER
  );
  CREATE INDEX idx_runs_task ON runs(task_id, attempt);

  CREATE TABLE approvals (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES tasks(id),
    capability    TEXT NOT NULL,
    status        TEXT NOT NULL,
    reason        TEXT NOT NULL,
    requested_at  TEXT NOT NULL,
    decided_at    TEXT,
    note          TEXT,
    UNIQUE(task_id, capability)
  );
  CREATE INDEX idx_approvals_status ON approvals(status);

  CREATE TABLE events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    level    TEXT NOT NULL,
    type     TEXT NOT NULL,
    task_id  TEXT,
    run_id   TEXT,
    message  TEXT NOT NULL,
    data     TEXT
  );
  CREATE INDEX idx_events_task ON events(task_id, id);

  CREATE TABLE schedules (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    cron           TEXT NOT NULL,
    template       TEXT NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    last_fired_at  TEXT,
    next_run_at    TEXT,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE kv (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  // v2 — context sources (data fetched by the kernel and handed to the agent)
  `
  ALTER TABLE tasks ADD COLUMN context TEXT NOT NULL DEFAULT '[]';
  `,
];

export type DB = DatabaseSync;

export function openDb(dbPath: string): DB {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function schemaVersion(db: DB): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}
