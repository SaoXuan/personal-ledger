const dayjs = require("dayjs");
const { db } = require("../db");
const { decimal } = require("../utils");

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

function normalizeMonthKey(rawMonth) {
  const month = String(rawMonth || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("月份格式必须是 YYYY-MM");
  }
  return month;
}

function monthToSnapshotDate(month) {
  return `${month}-01`;
}

function extractMonthFromInput(input) {
  if (input.snapshot_month) {
    return normalizeMonthKey(input.snapshot_month);
  }

  // 兼容旧前端传来的日期格式
  const maybeDate = String(input.snapshot_date || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(maybeDate)) {
    return maybeDate.slice(0, 7);
  }

  throw new Error("请选择月份");
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
      latest_date: row.latest_date ? row.latest_date.slice(0, 7) : "",
      latest_balance:
        row.latest_balance === null || row.latest_balance === undefined
          ? ""
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
        substr(s.snapshot_date, 1, 7) AS snapshot_month,
        s.balance
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
  const monthKey = extractMonthFromInput(input);
  const snapshotDate = monthToSnapshotDate(monthKey);
  const normalizedBalance = parseBalanceStrict(input.balance).toFixed(2);

  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error("请选择有效账户");
  }

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
    snapshot_date: snapshotDate,
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
        substr(s.snapshot_date, 1, 7) AS month,
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
  const total = getLatestBalances().reduce(
    (sum, row) => sum.plus(parseBalanceLenient(row.balance)),
    decimal(0)
  );
  return total.toFixed(2);
}

function getTrendData() {
  const rows = db
    .prepare(
      `
      SELECT
        substr(snapshot_date, 1, 7) AS month_key,
        balance
      FROM snapshots
      ORDER BY month_key
    `
    )
    .all();

  const totalsByMonth = new Map();
  for (const row of rows) {
    const current = decimal(totalsByMonth.get(row.month_key) || 0);
    totalsByMonth.set(
      row.month_key,
      current.plus(parseBalanceLenient(row.balance)).toFixed(2)
    );
  }

  return Array.from(totalsByMonth.entries()).map(([bucket, total]) => ({
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
        substr(s.snapshot_date, 1, 7) AS snapshot_month,
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
    dayjs().format("YYYY-MM-01");
  return {
    accounts,
    snapshots,
    lastDate: lastDate.slice(0, 7),
  };
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
