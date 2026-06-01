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

function listSnapshots({ accountId, month, limit = 200 } = {}) {
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
        AND (@month IS NULL OR substr(s.snapshot_date, 1, 7) = @month)
      ORDER BY s.snapshot_date DESC, s.id DESC
      LIMIT @limit
    `
    )
    .all({
      accountId: accountId || null,
      month: month || null,
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

function getAccountPerformance() {
  const rows = db
    .prepare(
      `
      SELECT
        a.id,
        a.name,
        curr.snapshot_date AS latest_date,
        curr.balance AS latest_balance,
        prev.snapshot_date AS previous_date,
        prev.balance AS previous_balance,
        firsts.snapshot_date AS first_date,
        firsts.balance AS first_balance,
        jan.snapshot_date AS jan_date,
        jan.balance AS jan_balance,
        snapshot_counts.snapshot_count AS snapshot_count
      FROM accounts a
      LEFT JOIN snapshots curr
        ON curr.account_id = a.id
       AND curr.snapshot_date = (
          SELECT MAX(s1.snapshot_date)
            FROM snapshots s1
           WHERE s1.account_id = a.id
        )
      LEFT JOIN snapshots prev
        ON prev.account_id = a.id
       AND prev.snapshot_date = (
          SELECT MAX(s2.snapshot_date)
            FROM snapshots s2
           WHERE s2.account_id = a.id
             AND curr.snapshot_date IS NOT NULL
             AND s2.snapshot_date < curr.snapshot_date
        )
      LEFT JOIN snapshots firsts
        ON firsts.account_id = a.id
       AND firsts.snapshot_date = (
          SELECT MIN(s3.snapshot_date)
            FROM snapshots s3
           WHERE s3.account_id = a.id
        )
      LEFT JOIN snapshots jan
        ON jan.account_id = a.id
       AND jan.snapshot_date = SUBSTR(curr.snapshot_date, 1, 4) || '-01-01'
      LEFT JOIN (
        SELECT account_id, COUNT(*) AS snapshot_count
          FROM snapshots
         GROUP BY account_id
      ) snapshot_counts ON snapshot_counts.account_id = a.id
      ORDER BY a.name
    `
    )
    .all();

  return rows.map((row) => {
    const hasLatest = row.latest_balance !== null && row.latest_balance !== undefined;
    const latest = hasLatest ? parseBalanceLenient(row.latest_balance) : null;
    const previous = row.previous_balance === null || row.previous_balance === undefined
      ? null
      : parseBalanceLenient(row.previous_balance);
    const first = row.first_balance === null || row.first_balance === undefined
      ? null
      : parseBalanceLenient(row.first_balance);
    const jan = row.jan_balance == null ? null : parseBalanceLenient(row.jan_balance);
    const monthlyChange = latest && previous ? latest.minus(previous) : null;
    const monthlyReturnRate = previous && !previous.isZero()
      ? monthlyChange.div(previous).times(100)
      : null;
    const cumulativeChange = latest && first ? latest.minus(first) : null;
    const cumulativeReturnRate = first && !first.isZero()
      ? cumulativeChange.div(first).times(100)
      : null;
    const ytdChange = latest && jan ? latest.minus(jan) : null;
    const ytdReturnRate = jan && !jan.isZero() ? ytdChange.div(jan).times(100) : null;
    const monthlyDirection = !monthlyChange || monthlyChange.isZero()
      ? "flat"
      : monthlyChange.isPositive()
        ? "up"
        : "down";
    const cumulativeDirection = !cumulativeChange || cumulativeChange.isZero()
      ? "flat"
      : cumulativeChange.isPositive()
        ? "up"
        : "down";
    const ytdDirection = !ytdChange || ytdChange.isZero()
      ? "flat"
      : ytdChange.isPositive()
        ? "up"
        : "down";

    return {
      id: row.id,
      name: row.name,
      latest_date: row.latest_date ? row.latest_date.slice(0, 7) : "",
      latest_balance: latest ? latest.toFixed(2) : "",
      previous_date: row.previous_date ? row.previous_date.slice(0, 7) : "",
      previous_balance: previous ? previous.toFixed(2) : "",
      first_date: row.first_date ? row.first_date.slice(0, 7) : "",
      first_balance: first ? first.toFixed(2) : "",
      jan_date: row.jan_date ? row.jan_date.slice(0, 7) : "",
      jan_balance: jan ? jan.toFixed(2) : "",
      snapshot_count: row.snapshot_count || 0,
      monthly_change_amount: monthlyChange ? monthlyChange.toFixed(2) : "",
      monthly_return_rate: monthlyReturnRate ? monthlyReturnRate.toFixed(2) : "",
      cumulative_change_amount: cumulativeChange ? cumulativeChange.toFixed(2) : "",
      cumulative_return_rate: cumulativeReturnRate ? cumulativeReturnRate.toFixed(2) : "",
      ytd_change_amount: ytdChange ? ytdChange.toFixed(2) : "",
      ytd_return_rate: ytdReturnRate ? ytdReturnRate.toFixed(2) : "",
      ytd_direction: ytdDirection,
      // 兼容旧前端字段
      change_amount: monthlyChange ? monthlyChange.toFixed(2) : "",
      return_rate: monthlyReturnRate ? monthlyReturnRate.toFixed(2) : "",
      direction: monthlyDirection,
      monthly_direction: monthlyDirection,
      cumulative_direction: cumulativeDirection,
    };
  });
}

function getPerformanceSummary() {
  const latestBalances = getLatestBalances();
  const latestMonth = db.prepare("SELECT MAX(snapshot_date) AS d FROM snapshots").get().d;
  if (!latestMonth) {
    return { latestMonth: "", previousMonth: "", changeAmount: "", returnRate: "", ytdChangeAmount: "", ytdReturnRate: "" };
  }

  const previousMonth = db
    .prepare("SELECT MAX(snapshot_date) AS d FROM snapshots WHERE snapshot_date < ?")
    .get(latestMonth).d;

  const totalForDate = (snapshotDate) =>
    db
      .prepare("SELECT balance FROM snapshots WHERE snapshot_date = ?")
      .all(snapshotDate)
      .reduce((sum, row) => sum.plus(parseBalanceLenient(row.balance)), decimal(0));

  const latestTotal = latestBalances.reduce(
    (sum, row) => sum.plus(parseBalanceLenient(row.balance)),
    decimal(0)
  );

  // YTD: portfolio level
  const latestYear = latestMonth.slice(0, 4);
  const janDate = latestYear + '-01-01';
  const janTotal = totalForDate(janDate);
  const ytdChangeAmount = !janTotal.isZero() ? latestTotal.minus(janTotal) : null;
  const ytdReturnRate = ytdChangeAmount && !janTotal.isZero()
    ? ytdChangeAmount.div(janTotal).times(100)
    : null;

  if (!previousMonth) {
    return {
      latestMonth: latestMonth.slice(0, 7),
      previousMonth: "",
      changeAmount: "",
      returnRate: "",
      ytdChangeAmount: ytdChangeAmount ? ytdChangeAmount.toFixed(2) : "",
      ytdReturnRate: ytdReturnRate ? ytdReturnRate.toFixed(2) : "",
    };
  }

  const previousTotal = totalForDate(previousMonth);
  const changeAmount = latestTotal.minus(previousTotal);
  const returnRate = previousTotal.isZero() ? null : changeAmount.div(previousTotal).times(100);

  return {
    latestMonth: latestMonth.slice(0, 7),
    previousMonth: previousMonth.slice(0, 7),
    changeAmount: changeAmount.toFixed(2),
    returnRate: returnRate ? returnRate.toFixed(2) : "",
    ytdChangeAmount: ytdChangeAmount ? ytdChangeAmount.toFixed(2) : "",
    ytdReturnRate: ytdReturnRate ? ytdReturnRate.toFixed(2) : "",
  };
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
  getAccountPerformance,
  getPerformanceSummary,
  getTrendData,
  getRecentSnapshots,
  countStats,
};
