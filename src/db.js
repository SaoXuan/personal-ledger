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
}

module.exports = {
  db,
  dbPath,
  initSchema,
};
