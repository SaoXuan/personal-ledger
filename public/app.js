(function () {
  const state = {
    period: "month",
    stats: { accounts: 0, snapshots: 0, lastDate: "-" },
    summaryRmb: "0.00",
    accounts: [],
    recentSnapshots: [],
    trend: [],
  };

  const dom = {
    statusText: document.getElementById("statusText"),
    refreshBtn: document.getElementById("refreshBtn"),
    quickSnapshotForm: document.getElementById("quickSnapshotForm"),
    quickAccountSelect: document.getElementById("quickAccountSelect"),
    periodSelect: document.getElementById("periodSelect"),
    applyTrendBtn: document.getElementById("applyTrendBtn"),
    trendTbody: document.getElementById("trendTbody"),
    accountsTbody: document.getElementById("accountsTbody"),
    snapshotsTbody: document.getElementById("snapshotsTbody"),
    openAccountModalBtn: document.getElementById("openAccountModalBtn"),
    accountFormDialog: document.getElementById("accountFormDialog"),
    accountModalTitle: document.getElementById("accountModalTitle"),
    cardTotalRmb: document.getElementById("cardTotalRmb"),
    cardAccountsCount: document.getElementById("cardAccountsCount"),
    cardSnapshotsCount: document.getElementById("cardSnapshotsCount"),
    cardLastDate: document.getElementById("cardLastDate"),
    toastContainer: document.getElementById("toastContainer"),
  };

  const accountModalEl = document.getElementById("accountModal");
  const accountModal = new bootstrap.Modal(accountModalEl);
  let pollingTimer = null;

  function escapeHtml(input) {
    return String(input ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? "-");
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function showToast(message, type = "success") {
    const className = type === "error" ? "alert-danger" : "alert-success";
    const el = document.createElement("div");
    el.className = `alert ${className} py-2 mb-2`;
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  async function apiGet(path) {
    const response = await fetch(path);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "请求失败");
    }
    return data;
  }

  async function apiSend(path, method, payload) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "请求失败");
    }
    return data;
  }

  function renderCards() {
    dom.cardTotalRmb.textContent = formatNumber(state.summaryRmb);
    dom.cardAccountsCount.textContent = String(state.stats.accounts ?? 0);
    dom.cardSnapshotsCount.textContent = String(state.stats.snapshots ?? 0);
    dom.cardLastDate.textContent = state.stats.lastDate || "-";
  }

  function renderAccountSelect() {
    const options = [`<option value="">请选择账户</option>`];
    for (const row of state.accounts) {
      options.push(`<option value="${row.id}">${escapeHtml(row.name)}</option>`);
    }
    dom.quickAccountSelect.innerHTML = options.join("");
  }

  function renderTrendTable() {
    if (!state.trend.length) {
      dom.trendTbody.innerHTML = `<tr><td colspan="2" class="text-secondary">暂无数据</td></tr>`;
      return;
    }

    dom.trendTbody.innerHTML = state.trend
      .map(
        (row) => `
      <tr>
        <td>${escapeHtml(row.bucket)}</td>
        <td class="text-end fw-semibold">${formatNumber(row.total)}</td>
      </tr>
    `
      )
      .join("");
  }

  function renderAccountsTable() {
    if (!state.accounts.length) {
      dom.accountsTbody.innerHTML =
        '<tr><td colspan="3" class="text-secondary">还没有账户，先新增一个。</td></tr>';
      return;
    }

    dom.accountsTbody.innerHTML = state.accounts
      .map(
        (row) => `
      <tr>
        <td class="fw-semibold">${escapeHtml(row.name)}</td>
        <td class="text-end">${formatNumber(row.latestBalance)}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" data-action="quick-fill" data-id="${row.id}">记一笔</button>
            <button class="btn btn-outline-secondary" data-action="edit-account" data-id="${row.id}">编辑</button>
            <button class="btn btn-outline-danger" data-action="delete-account" data-id="${row.id}">删除</button>
          </div>
        </td>
      </tr>
    `
      )
      .join("");
  }

  function renderSnapshotsTable() {
    const rows = state.recentSnapshots.slice(0, 80);
    if (!rows.length) {
      dom.snapshotsTbody.innerHTML =
        '<tr><td colspan="4" class="text-secondary">暂无余额记录。</td></tr>';
      return;
    }

    dom.snapshotsTbody.innerHTML = rows
      .map(
        (row) => `
      <tr>
        <td>${escapeHtml(row.snapshotDate)}</td>
        <td>${escapeHtml(row.accountName)}</td>
        <td class="text-end">${formatNumber(row.balance)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" data-action="delete-snapshot" data-id="${row.id}">
            删除
          </button>
        </td>
      </tr>
    `
      )
      .join("");
  }

  async function loadBootstrap(silent = false) {
    const params = new URLSearchParams({ period: state.period });
    const data = await apiGet(`/api/bootstrap?${params.toString()}`);

    state.stats = data.stats || state.stats;
    state.summaryRmb = data.summaryRmb || "0.00";
    state.accounts = data.accounts || [];
    state.recentSnapshots = data.recentSnapshots || [];
    state.trend = data.trend || [];

    renderCards();
    renderAccountSelect();
    renderTrendTable();
    renderAccountsTable();
    renderSnapshotsTable();

    if (!silent) {
      dom.statusText.textContent = "数据已更新";
    }
  }

  function resetAccountForm() {
    dom.accountFormDialog.reset();
    dom.accountFormDialog.elements.id.value = "";
    dom.accountModalTitle.textContent = "新增账户";
  }

  async function editAccount(id) {
    const data = await apiGet(`/api/accounts/${id}`);
    dom.accountModalTitle.textContent = "编辑账户";
    dom.accountFormDialog.elements.id.value = data.account.id;
    dom.accountFormDialog.elements.name.value = data.account.name;
    accountModal.show();
  }

  async function removeAccount(id) {
    if (!confirm("确认删除这个账户及其余额记录吗？")) return;
    await apiSend(`/api/accounts/${id}`, "DELETE");
    showToast("账户已删除");
    await loadBootstrap(true);
  }

  async function removeSnapshot(id) {
    if (!confirm("确认删除这条余额记录吗？")) return;
    await apiSend(`/api/snapshots/${id}`, "DELETE");
    showToast("记录已删除");
    await loadBootstrap(true);
  }

  async function onQuickSnapshotSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(dom.quickSnapshotForm).entries());
    await apiSend("/api/snapshots", "POST", payload);
    showToast("余额保存成功");

    const currentAccount = dom.quickSnapshotForm.elements.account_id.value;
    dom.quickSnapshotForm.reset();
    dom.quickSnapshotForm.elements.account_id.value = currentAccount;
    dom.quickSnapshotForm.elements.snapshot_date.valueAsDate = new Date();

    await loadBootstrap(true);
  }

  async function onAccountSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(dom.accountFormDialog).entries());
    await apiSend("/api/accounts", "POST", payload);
    accountModal.hide();
    showToast("账户保存成功");
    await loadBootstrap(true);
  }

  function bindEvents() {
    dom.refreshBtn.addEventListener("click", () => {
      loadBootstrap().catch((error) => showToast(error.message, "error"));
    });

    dom.applyTrendBtn.addEventListener("click", () => {
      state.period = dom.periodSelect.value;
      loadBootstrap().catch((error) => showToast(error.message, "error"));
    });

    dom.quickSnapshotForm.addEventListener("submit", (event) => {
      onQuickSnapshotSubmit(event).catch((error) => showToast(error.message, "error"));
    });

    dom.openAccountModalBtn.addEventListener("click", () => {
      resetAccountForm();
      accountModal.show();
    });

    dom.accountFormDialog.addEventListener("submit", (event) => {
      onAccountSubmit(event).catch((error) => showToast(error.message, "error"));
    });

    dom.accountsTbody.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = Number(btn.dataset.id || 0);
      if (!id) return;

      if (action === "quick-fill") {
        dom.quickAccountSelect.value = String(id);
        dom.quickSnapshotForm.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      if (action === "edit-account") {
        editAccount(id).catch((error) => showToast(error.message, "error"));
        return;
      }

      if (action === "delete-account") {
        removeAccount(id).catch((error) => showToast(error.message, "error"));
      }
    });

    dom.snapshotsTbody.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-action='delete-snapshot']");
      if (!btn) return;
      const id = Number(btn.dataset.id || 0);
      if (!id) return;
      removeSnapshot(id).catch((error) => showToast(error.message, "error"));
    });
  }

  function startPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => {
      loadBootstrap(true).catch(() => {
        dom.statusText.textContent = "自动刷新失败，稍后重试";
      });
    }, 15000);
  }

  async function start() {
    bindEvents();
    await loadBootstrap(true);
    startPolling();
  }

  start().catch((error) => {
    showToast(error.message, "error");
    // eslint-disable-next-line no-console
    console.error(error);
  });
})();
