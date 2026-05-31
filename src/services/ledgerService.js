const dayjs = require("dayjs");
const { db } = require("../db");
const { decimal, normalizeDate, isDateString } = require("../utils");

function cleanBalanceText(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[,\s，￥¥]/g, "");
}

function parseBalanceStrict(raw) {
  const cleaned = cleanBalanceText(raw);
  if (!cleaned) {
    throw new Error("余额不能为空");
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error("余额格式不正确，请输入数字");
  }
  return decimal(cleaned);
}

function parseBalanceLenient(raw) {
  const cleaned = cleanBalanceText(raw);
  if (!cleaned || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
    return decimal(0);
  }
  return decimal(cleaned);
}

function getAccountsWithLatest() {
  return db
    .prepare(
      `
      SELECT
        a.id,
        a.name,
        s.snapshot_date AS latest_date,
        s.balance AS latest_balance
      FROM accounts a
      LEFT JOIN snapshots s
        ON s.account_id = a.id
       AND s.snapshot_date = (
          SELECT MAX(s2.snapshot_date)
            FROM snapshots s2
           WHERE s2.account_id = a.id
        )
      ORDER BY a.name
    `
    )
    .all()
    .map((row) => ({
      ...row,
      latest_balance:
        row.latest_balance === null || row.latest_balance === undefined
          ? row.latest_balance
          : parseBalanceLenient(row.latest_balance).toFixed(2),
    }));
}

function getAccountById(accountId) {
  return db
    .prepare(
      `
      SELECT id, name
      FROM accounts
      WHERE id = ?
    `
    )
    .get(accountId);
}

function createOrUpdateAccount(input) {
  const payload = {
    name: String(input.name || "").trim(),
    category: "default",
    platform: null,
    currency: "CNY",
    note: null,
    dimensions_json: "{}",
  };

  if (!payload.name) {
    throw new Error("账户名称不能为空");
  }

  db.prepare(
    `
    INSERT INTO accounts (name, category, platform, currency, note, dimensions_json)
    VALUES (@name, @category, @platform, @currency, @note, @dimensions_json)
    ON CONFLICT(name) DO UPDATE SET
      updated_at = datetime('now')
  `
  ).run(payload);
}

function updateAccountById(accountId, input) {
  const payload = {
    id: accountId,
    name: String(input.name || "").trim(),
  };

  if (!payload.name) {
    throw new Error("账户名称不能为空");
  }

  db.prepare(
    `
    UPDATE accounts
       SET name = @name,
           updated_at = datetime('now')
     WHERE id = @id
  `
  ).run(payload);
}

function deleteAccount(accountId) {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
}

function listSnapshots({ accountId, limit = 200 } = {}) {
  return db
    .prepare(
      `
      SELECT
        s.id,
        s.account_id,
        a.name AS account_name,
        s.snapshot_date,
        s.balance,
        s.source
      FROM snapshots s
      JOIN accounts a ON a.id = s.account_id
      WHERE (@accountId IS NULL OR s.account_id = @accountId)
      ORDER BY s.snapshot_date DESC, s.id DESC
      LIMIT @limit
    `
    )
    .all({
      accountId: accountId || null,
      limit,
    })
    .map((row) => ({
      ...row,
      balance: parseBalanceLenient(row.balance).toFixed(2),
    }));
}

function upsertSnapshot(input) {
  const accountId = Number(input.account_id);
  const snapshotDate = String(input.snapshot_date || "").trim();
  const balanceText = String(input.balance || "").trim();

  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error("请选择有效账户");
  }
  if (!isDateString(snapshotDate)) {
    throw new Error("日期格式必须是 YYYY-MM-DD");
  }
  const normalizedBalance = parseBalanceStrict(balanceText).toFixed(2);

  db.prepare(
    `
    INSERT INTO snapshots (account_id, snapshot_date, balance, source, note, meta_json)
    VALUES (@account_id, @snapshot_date, @balance, @source, @note, @meta_json)
    ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
      balance = excluded.balance,
      source = excluded.source,
      note = excluded.note,
      meta_json = excluded.meta_json,
      updated_at = datetime('now')
  `
  ).run({
    account_id: accountId,
    snapshot_date: normalizeDate(snapshotDate),
    balance: normalizedBalance,
    source: "manual",
    note: null,
    meta_json: "{}",
  });
}

function deleteSnapshot(snapshotId) {
  db.prepare("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
}

function getLatestBalances() {
  return db
    .prepare(
      `
      SELECT
        a.id,
        a.name,
        s.snapshot_date AS date,
        s.balance
      FROM accounts a
      LEFT JOIN snapshots s
        ON s.account_id = a.id
       AND s.snapshot_date = (
          SELECT MAX(s2.snapshot_date)
          FROM snapshots s2
          WHERE s2.account_id = a.id
        )
      ORDER BY a.name
    `
    )
    .all()
    .filter((x) => x.balance !== null)
    .map((row) => ({
      ...row,
      balance: parseBalanceLenient(row.balance).toFixed(2),
    }));
}

function getSummaryRmb() {
  const total = getLatestBalances().reduce((sum, row) => sum.plus(parseBalanceLenient(row.balance)), decimal(0));
  return total.toFixed(2);
}

function getPeriodExpr(period) {
  if (period === "day") return "s.snapshot_date";
  if (period === "week") return "strftime('%Y-W%W', s.snapshot_date)";
  return "strftime('%Y-%m', s.snapshot_date)";
}

function getTrendData({ period = "month" } = {}) {
  const sql = `
    WITH bucketed AS (
      SELECT
        s.account_id,
        ${getPeriodExpr(period)} AS bucket,
        MAX(s.snapshot_date) AS max_date
      FROM snapshots s
      GROUP BY s.account_id, bucket
    ),
    picked AS (
      SELECT
        b.bucket AS bucket,
        s.balance AS balance
      FROM bucketed b
      JOIN snapshots s ON s.account_id = b.account_id AND s.snapshot_date = b.max_date
    )
    SELECT bucket, balance
    FROM picked
    ORDER BY bucket
  `;

  const rows = db.prepare(sql).all();
  const map = new Map();

  for (const row of rows) {
    const current = decimal(map.get(row.bucket) || 0);
    map.set(row.bucket, current.plus(parseBalanceLenient(row.balance)).toFixed(2));
  }

  return Array.from(map.entries()).map(([bucket, total]) => ({
    bucket,
    total,
  }));
}

function getRecentSnapshots(limit = 12) {
  return db
    .prepare(
      `
      SELECT
        s.id,
        a.name AS account_name,
        s.snapshot_date,
        s.balance
      FROM snapshots s
      JOIN accounts a ON a.id = s.account_id
      ORDER BY s.snapshot_date DESC, s.id DESC
      LIMIT ?
    `
    )
    .all(limit)
    .map((row) => ({
      ...row,
      balance: parseBalanceLenient(row.balance).toFixed(2),
    }));
}

function countStats() {
  const accounts = db.prepare("SELECT COUNT(*) AS c FROM accounts").get().c;
  const snapshots = db.prepare("SELECT COUNT(*) AS c FROM snapshots").get().c;
  const lastDate =
    db.prepare("SELECT MAX(snapshot_date) AS d FROM snapshots").get().d ||
    dayjs().format("YYYY-MM-DD");
  return { accounts, snapshots, lastDate };
}

module.exports = {
  getAccountsWithLatest,
  getAccountById,
  createOrUpdateAccount,
  updateAccountById,
  deleteAccount,
  listSnapshots,
  upsertSnapshot,
  deleteSnapshot,
  getLatestBalances,
  getSummaryRmb,
  getTrendData,
  getRecentSnapshots,
  countStats,
};
