const express = require("express");
const dayjs = require("dayjs");
const {
  countStats,
  getAccountsWithLatest,
  getAccountById,
  createOrUpdateAccount,
  updateAccountById,
  deleteAccount,
  listSnapshots,
  upsertSnapshot,
  deleteSnapshot,
  getSummaryRmb,
  getTrendData,
  getRecentSnapshots,
} = require("../services/ledgerService");
const { isDateString } = require("../utils");

const router = express.Router();

function ok(res, data = {}) {
  return res.json({ ok: true, ...data });
}

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ ok: false, message });
}

function normalizeAccounts(accounts) {
  return accounts.map((row) => ({
    id: row.id,
    name: row.name,
    latestDate: row.latest_date || "",
    latestBalance: row.latest_balance || "",
  }));
}

function normalizeSnapshots(snapshots) {
  return snapshots.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    snapshotDate: row.snapshot_date,
    balance: row.balance,
    source: row.source || "manual",
  }));
}

function buildDashboardPayload({ period = "month" } = {}) {
  return {
    stats: countStats(),
    summaryRmb: getSummaryRmb(),
    trend: getTrendData({ period }),
    accounts: normalizeAccounts(getAccountsWithLatest()),
    recentSnapshots: normalizeSnapshots(listSnapshots({ limit: 100 })),
    quickSnapshots: getRecentSnapshots(16).map((x) => ({
      id: x.id,
      accountName: x.account_name,
      snapshotDate: x.snapshot_date,
      balance: x.balance,
    })),
  };
}

router.get("/", (req, res) => {
  res.render("app", {
    title: "Personal Ledger",
    today: dayjs().format("YYYY-MM-DD"),
  });
});

router.get("/api/bootstrap", (req, res) => {
  const period = ["day", "week", "month"].includes(req.query.period)
    ? req.query.period
    : "month";
  return ok(res, buildDashboardPayload({ period }));
});

router.get("/api/accounts", (req, res) => {
  return ok(res, { accounts: normalizeAccounts(getAccountsWithLatest()) });
});

router.get("/api/accounts/:id", (req, res) => {
  const id = Number(req.params.id || 0);
  const row = getAccountById(id);
  if (!row) return fail(res, 404, "账户不存在");
  return ok(res, {
    account: {
      id: row.id,
      name: row.name,
    },
  });
});

router.post("/api/accounts", (req, res) => {
  try {
    const id = Number(req.body.id || 0);
    if (id > 0) {
      updateAccountById(id, req.body);
      return ok(res, { message: "账户已更新" });
    }

    createOrUpdateAccount(req.body);
    return ok(res, { message: "账户已创建" });
  } catch (error) {
    return fail(res, 400, error.message);
  }
});

router.delete("/api/accounts/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return fail(res, 400, "无效账户 ID");
    deleteAccount(id);
    return ok(res, { message: "账户已删除" });
  } catch (error) {
    return fail(res, 400, error.message);
  }
});

router.get("/api/snapshots", (req, res) => {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  return ok(res, {
    snapshots: normalizeSnapshots(
      listSnapshots({
        accountId: accountId || null,
        limit: 200,
      })
    ),
  });
});

router.post("/api/snapshots", (req, res) => {
  try {
    if (req.body.snapshot_date && !isDateString(req.body.snapshot_date)) {
      return fail(res, 400, "日期格式必须是 YYYY-MM-DD");
    }
    upsertSnapshot(req.body);
    return ok(res, { message: "余额记录已保存" });
  } catch (error) {
    return fail(res, 400, error.message);
  }
});

router.delete("/api/snapshots/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return fail(res, 400, "无效记录 ID");
    deleteSnapshot(id);
    return ok(res, { message: "记录已删除" });
  } catch (error) {
    return fail(res, 400, error.message);
  }
});

module.exports = router;
