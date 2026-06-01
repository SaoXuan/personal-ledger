const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");
const defaultDbPath = path.join(projectRoot, "data", "ledger.db");
const dbPath = (() => {
  const raw = process.env.DB_PATH;
  if (!raw || !String(raw).trim()) return defaultDbPath;
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
})();

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(dbPath);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'default',
      platform TEXT,
      currency TEXT NOT NULL DEFAULT 'CNY',
      note TEXT,
      dimensions_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      balance TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      note TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_id, snapshot_date),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date);

    CREATE TABLE IF NOT EXISTS investment_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      note_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notes_date ON investment_notes(note_date DESC);
  `);

  // 统一历史与未来数据口径：全部以 CNY 计量
  db.exec(`
    UPDATE accounts
       SET currency = 'CNY'
     WHERE currency IS NULL OR UPPER(currency) <> 'CNY';

    UPDATE snapshots
       SET balance = REPLACE(
                      REPLACE(
                        REPLACE(
                          REPLACE(
                            REPLACE(
                              REPLACE(balance, ',', ''),
                              '，', ''
                            ),
                            '¥', ''
                          ),
                          '￥', ''
                        ),
                        ' ', ''
                      ),
                      char(160), ''
                    )
     WHERE balance IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_accounts_currency_insert
    BEFORE INSERT ON accounts
    FOR EACH ROW
    WHEN NEW.currency IS NOT NULL AND UPPER(NEW.currency) <> 'CNY'
    BEGIN
      SELECT RAISE(ABORT, 'currency must be CNY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_accounts_currency_update
    BEFORE UPDATE OF currency ON accounts
    FOR EACH ROW
    WHEN NEW.currency IS NOT NULL AND UPPER(NEW.currency) <> 'CNY'
    BEGIN
      SELECT RAISE(ABORT, 'currency must be CNY');
    END;
  `);

  // 一次性迁移：将日度记录归并为月度记录（每账户每月仅保留最新一条）
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.prepare(
    `
    INSERT OR IGNORE INTO schema_migrations(key, value)
    VALUES ('monthly_snapshot_v1', '0')
  `
  ).run();

  const migrationState = db
    .prepare(`SELECT value FROM schema_migrations WHERE key = 'monthly_snapshot_v1'`)
    .get();

  if (!migrationState || migrationState.value !== "1") {
    db.exec(`
      BEGIN;

      CREATE TABLE snapshots_monthly_tmp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        snapshot_date TEXT NOT NULL,
        balance TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        note TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        UNIQUE(account_id, snapshot_date),
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      WITH ranked AS (
        SELECT
          account_id,
          strftime('%Y-%m', snapshot_date) AS month_key,
          balance,
          source,
          note,
          meta_json,
          created_at,
          updated_at,
          snapshot_date,
          id,
          ROW_NUMBER() OVER (
            PARTITION BY account_id, strftime('%Y-%m', snapshot_date)
            ORDER BY snapshot_date DESC, id DESC
          ) AS rn
        FROM snapshots
      )
      INSERT INTO snapshots_monthly_tmp (
        account_id,
        snapshot_date,
        balance,
        source,
        note,
        meta_json,
        created_at,
        updated_at
      )
      SELECT
        account_id,
        month_key || '-01' AS snapshot_date,
        balance,
        source,
        note,
        meta_json,
        COALESCE(created_at, datetime('now')),
        updated_at
      FROM ranked
      WHERE rn = 1;

      DROP TABLE snapshots;
      ALTER TABLE snapshots_monthly_tmp RENAME TO snapshots;

      CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date);

      COMMIT;
    `);

    db.prepare(
      `
      UPDATE schema_migrations
         SET value = '1'
       WHERE key = 'monthly_snapshot_v1'
    `
    ).run();
  }
}

module.exports = {
  db,
  dbPath,
  initSchema,
};
