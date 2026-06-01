(function () {
  const state = {
    stats: { accounts: 0, snapshots: 0, lastDate: "-" },
    summaryRmb: "0.00",
    performanceSummary: {},
    accounts: [],
    accountPerformance: [],
    recentSnapshots: [],
    trend: [],
    snapshotsByAccount: {},
  };

  let chartInstance = null;

  const dom = {
    statusText: document.getElementById("statusText"),
    refreshBtn: document.getElementById("refreshBtn"),
    quickSnapshotForm: document.getElementById("quickSnapshotForm"),
    quickAccountSelect: document.getElementById("quickAccountSelect"),
    accountsTbody: document.getElementById("accountsTbody"),
    snapshotsTbody: document.getElementById("snapshotsTbody"),
    openAccountModalBtn: document.getElementById("openAccountModalBtn"),
    accountFormDialog: document.getElementById("accountFormDialog"),
    accountModalTitle: document.getElementById("accountModalTitle"),
    cardTotalRmb: document.getElementById("cardTotalRmb"),
    cardAccountsCount: document.getElementById("cardAccountsCount"),
    cardSnapshotsCount: document.getElementById("cardSnapshotsCount"),
    cardLastDate: document.getElementById("cardLastDate"),
    cardTotalChange: document.getElementById("cardTotalChange"),
    cardTotalReturn: document.getElementById("cardTotalReturn"),
    cardTotalChangeRange: document.getElementById("cardTotalChangeRange"),
    heroChangeBadge: document.getElementById("heroChangeBadge"),
    heroSparkline: document.getElementById("heroSparkline"),
    toastContainer: document.getElementById("toastContainer"),
    chartModalBackdrop: document.getElementById("chartModalBackdrop"),
    chartModalTitle: document.getElementById("chartModalTitle"),
    chartModalMeta: document.getElementById("chartModalMeta"),
    chartModalClose: document.getElementById("chartModalClose"),
    chartCanvas: document.getElementById("chartCanvas"),
  };

  const accountModalEl = document.getElementById("accountModal");
  const accountModal = new bootstrap.Modal(accountModalEl);

  function getCurrentMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function escapeHtml(input) {
    return String(input ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getInitials(name) {
    const text = String(name || "账").trim();
    if (!text) return "账";
    return Array.from(text).slice(0, 2).join("");
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "-";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? "-");
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatSignedNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const prefix = n > 0 ? "+" : "";
    return `${prefix}${formatNumber(n)}`;
  }

  function formatReturnRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "暂无";
    const prefix = n > 0 ? "+" : "";
    return `${prefix}${n.toFixed(2)}%`;
  }

  function directionClass(direction) {
    if (direction === "up") return "return-up";
    if (direction === "down") return "return-down";
    return "return-flat";
  }

  function directionIcon(direction) {
    if (direction === "up") return "bi-arrow-up-right";
    if (direction === "down") return "bi-arrow-down-right";
    return "bi-dash-lg";
  }

  function showToast(message, type = "success") {
    const className = type === "error" ? "pl-toast-error" : "pl-toast-success";
    const el = document.createElement("div");
    el.className = `pl-toast ${className}`;
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

  /* ═══════════════ SVG Sparkline ═══════════════ */
  function createSparklineSVG(values, options = {}) {
    const {
      width = 80,
      height = 28,
      strokeWidth = 1.5,
      color = null,
      padding = 2,
    } = options;

    if (!values || values.length < 2) return null;

    const nums = values.map(Number);
    const autoColor =
      nums[nums.length - 1] >= nums[0] ? "var(--pl-green)" : "var(--pl-red)";
    const strokeColor = color || autoColor;

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min || 1;

    const points = nums
      .map((v, i) => {
        const x = padding + (i / (nums.length - 1)) * (width - padding * 2);
        const y = padding + (1 - (v - min) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline-svg"><polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  /* ═══════════════ Hero Sparkline ═══════════════ */
  function renderHeroSparkline() {
    if (!dom.heroSparkline) return;
    if (!state.trend || state.trend.length < 2) {
      dom.heroSparkline.innerHTML = "";
      return;
    }

    // trend is newest-first; reverse for left-to-right chronological
    const values = [...state.trend].reverse().map((t) => Number(t.total) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 400;
    const h = 60;

    const pointsArr = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = (1 - (v - min) / range) * h;
      return [x, y];
    });

    const linePoints = pointsArr
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

    const pathD =
      `M0,${h} ` +
      pointsArr.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
      ` L${w},${h} Z`;

    dom.heroSparkline.innerHTML =
      `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
      `<path d="${pathD}" fill="rgba(99,102,241,.12)"/>` +
      `<polyline points="${linePoints}" fill="none" stroke="rgba(99,102,241,.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`;
  }

  /* ═══════════════ Render: Cards ═══════════════ */
  function renderCards() {
    dom.cardTotalRmb.textContent = formatNumber(state.summaryRmb);
    dom.cardAccountsCount.textContent = String(state.stats.accounts ?? 0);
    dom.cardSnapshotsCount.textContent = String(state.stats.snapshots ?? 0);
    dom.cardLastDate.textContent = state.stats.lastDate || "-";

    const summary = state.performanceSummary || {};

    /* Total change metric card */
    dom.cardTotalChange.textContent = summary.changeAmount
      ? formatSignedNumber(summary.changeAmount)
      : "-";

    const changeNum = Number(summary.changeAmount);
    if (Number.isFinite(changeNum) && changeNum !== 0) {
      dom.cardTotalChange.className = `metric-value text-tabular ${changeNum > 0 ? "text-green" : "text-red"}`;
    } else {
      dom.cardTotalChange.className = "metric-value text-tabular";
    }

    /* Total return metric card */
    dom.cardTotalReturn.textContent = summary.returnRate
      ? formatReturnRate(summary.returnRate)
      : "-";

    const returnNum = Number(summary.returnRate);
    if (Number.isFinite(returnNum) && returnNum !== 0) {
      dom.cardTotalReturn.className = `metric-value ${returnNum > 0 ? "text-green" : "text-red"}`;
    } else {
      dom.cardTotalReturn.className = "metric-value";
    }

    dom.cardTotalChangeRange.textContent = summary.previousMonth
      ? `${summary.previousMonth} → ${summary.latestMonth}`
      : "等待下月数据";

    /* Hero change badge */
    if (dom.heroChangeBadge) {
      if (summary.changeAmount !== undefined && summary.changeAmount !== null) {
        const n = Number(summary.changeAmount);
        if (Number.isFinite(n) && n !== 0) {
          const dir = n > 0 ? "up" : "down";
          const cls = dir === "up" ? "hero-change-up" : "hero-change-down";
          const icon = dir === "up" ? "bi-arrow-up-right" : "bi-arrow-down-right";
          const rateText = summary.returnRate ? ` (${formatReturnRate(summary.returnRate)})` : "";
          dom.heroChangeBadge.innerHTML =
            `<span class="hero-change-badge ${cls}"><i class="bi ${icon}"></i>${formatSignedNumber(n)}${escapeHtml(rateText)}</span>`;
        } else {
          dom.heroChangeBadge.innerHTML = "";
        }
      } else {
        dom.heroChangeBadge.innerHTML = "";
      }
    }
  }

  /* ═══════════════ Render: Account Select ═══════════════ */
  function renderAccountSelect() {
    const options = [`<option value="">请选择账户</option>`];
    for (const row of state.accounts) {
      options.push(`<option value="${row.id}">${escapeHtml(row.name)}</option>`);
    }
    dom.quickAccountSelect.innerHTML = options.join("");
  }

  /* ═══════════════ Render: Accounts Table (full width, with sparkline) ═══════════════ */
  function renderAccountsTable() {
    const rows = state.accountPerformance.length ? state.accountPerformance : state.accounts;
    if (!rows.length) {
      dom.accountsTbody.innerHTML =
        '<tr><td colspan="5" class="text-muted-3" style="padding:1rem;">还没有账户，先新增一个。</td></tr>';
      return;
    }

    dom.accountsTbody.innerHTML = rows
      .map((row, idx) => {
        const hasLatest = row.latestBalance !== undefined && row.latestBalance !== "";
        const hasMonthly = row.monthlyReturnRate !== undefined && row.monthlyReturnRate !== "";
        const hasCumulative = row.cumulativeReturnRate !== undefined && row.cumulativeReturnRate !== "";
        const monthlyDirection = row.monthlyDirection || row.direction || "flat";
        const cumulativeDirection = row.cumulativeDirection || "flat";

        /* Balance + monthly change (stacked) */
        const monthlyChangeClass = monthlyDirection === "up" ? "text-green" : monthlyDirection === "down" ? "text-red" : "text-muted-3";
        const balanceHtml = hasLatest ? formatNumber(row.latestBalance) : "-";
        const changeHtml = hasMonthly
          ? `<div class="small ${monthlyChangeClass} text-tabular" style="font-size:.72rem;">${formatSignedNumber(row.monthlyChangeAmount)}</div>`
          : "";

        /* Return badges (monthly + cumulative stacked) */
        const monthlyBadge = hasMonthly
          ? `<span class="return-badge ${directionClass(monthlyDirection)}"><i class="bi ${directionIcon(monthlyDirection)}"></i>月 ${formatReturnRate(row.monthlyReturnRate)}</span>`
          : '<span class="text-muted-3" style="font-size:.7rem;">待上期</span>';
        const cumulativeBadge = hasCumulative
          ? `<span class="return-badge ${directionClass(cumulativeDirection)}"><i class="bi ${directionIcon(cumulativeDirection)}"></i>累 ${formatReturnRate(row.cumulativeReturnRate)}</span>`
          : "";

        const recordInfo = `${Number(row.snapshotCount || 0)} 条`;

        /* Sparkline */
        const accountSnapshots = state.snapshotsByAccount[row.id] || [];
        let sparklineTd;
        if (accountSnapshots.length >= 2) {
          const vals = accountSnapshots.map((s) => Number(s.balance));
          const svg = createSparklineSVG(vals);
          sparklineTd = `<td class="sparkline-cell" data-action="show-chart" data-account-id="${row.id}" data-account-name="${escapeHtml(row.name)}">${svg || ""}</td>`;
        } else {
          sparklineTd = `<td class="sparkline-cell"><span class="sparkline-empty">数据不足</span></td>`;
        }

        const delay = idx * 30;

        return `
      <tr style="animation-delay:${delay}ms">
        <td>
          <div class="account-chip">
            <span class="account-avatar">${escapeHtml(getInitials(row.name))}</span>
            <div>
              <div class="fw-600" style="font-size:.82rem;">${escapeHtml(row.name)}</div>
              <div class="text-muted-3" style="font-size:.68rem;">${escapeHtml(recordInfo)}</div>
            </div>
          </div>
        </td>
        <td class="text-end">
          <div class="fw-600 text-tabular" style="font-size:.85rem;">${balanceHtml}</div>
          ${changeHtml}
        </td>
        ${sparklineTd}
        <td class="text-end">
          <div style="margin-bottom:.2rem;">${monthlyBadge}</div>
          ${cumulativeBadge ? `<div>${cumulativeBadge}</div>` : ""}
        </td>
        <td class="text-end">
          <div style="display:flex;gap:.3rem;justify-content:flex-end;">
            <button class="btn-action" data-action="quick-fill" data-id="${row.id}" title="快速记账"><i class="bi bi-pencil-square"></i></button>
            <button class="btn-action" data-action="edit-account" data-id="${row.id}" title="编辑"><i class="bi bi-gear"></i></button>
            <button class="btn-action btn-action-danger" data-action="delete-account" data-id="${row.id}" title="删除"><i class="bi bi-trash"></i></button>
          </div>
        </td>
      </tr>`;
      })
      .join("");
  }

  /* ═══════════════ Render: Snapshots Table ═══════════════ */
  function renderSnapshotsTable() {
    const rows = state.recentSnapshots.slice(0, 80);
    if (!rows.length) {
      dom.snapshotsTbody.innerHTML =
        '<tr><td colspan="4" class="text-muted-3" style="padding:1rem;">暂无余额记录。</td></tr>';
      return;
    }

    dom.snapshotsTbody.innerHTML = rows
      .map(
        (row, idx) => {
          const delay = idx * 20;
          return `
      <tr style="animation-delay:${delay}ms">
        <td><span class="month-pill">${escapeHtml(row.snapshotMonth)}</span></td>
        <td>
          <div class="account-chip">
            <span class="account-avatar">${escapeHtml(getInitials(row.accountName))}</span>
            <span style="font-size:.82rem;">${escapeHtml(row.accountName)}</span>
          </div>
        </td>
        <td class="text-end text-tabular fw-600" style="font-size:.85rem;">${formatNumber(row.balance)}</td>
        <td class="text-end">
          <button class="btn-action btn-action-danger" data-action="delete-snapshot" data-id="${row.id}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
        }
      )
      .join("");
  }

  /* ═══════════════ Snapshot Data for Sparklines ═══════════════ */
  async function loadSnapshotData() {
    try {
      const data = await apiGet("/api/snapshots");
      const snapshots = data.snapshots || [];
      const grouped = {};
      for (const s of snapshots) {
        const aid = s.accountId;
        if (!aid) continue;
        if (!grouped[aid]) grouped[aid] = [];
        grouped[aid].push(s);
      }
      // Sort each group by snapshotMonth ascending (oldest → newest)
      for (const aid of Object.keys(grouped)) {
        grouped[aid].sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
      }
      state.snapshotsByAccount = grouped;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to load sparkline data:", e);
    }
  }

  /* ═══════════════ Chart Modal ═══════════════ */
  function openChartModal(accountId, accountName) {
    const snapshots = state.snapshotsByAccount[accountId] || [];
    if (snapshots.length < 2) return;

    dom.chartModalTitle.textContent = accountName;
    dom.chartModalMeta.textContent =
      snapshots[0].snapshotMonth +
      " ~ " +
      snapshots[snapshots.length - 1].snapshotMonth +
      " \u00b7 " +
      snapshots.length +
      " 条记录";
    dom.chartModalBackdrop.style.display = "flex";

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const labels = snapshots.map((s) => s.snapshotMonth);
    const values = snapshots.map((s) => Number(s.balance));

    chartInstance = new Chart(dom.chartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: accountName,
            data: values,
            borderColor: "#6366f1",
            backgroundColor: "rgba(99,102,241,.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return (
                  "\u00a5" +
                  Number(ctx.parsed.y).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                );
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            ticks: {
              font: { size: 11 },
              callback: function (v) {
                if (Math.abs(v) >= 1000) {
                  return "\u00a5" + (v / 1000).toFixed(0) + "k";
                }
                return "\u00a5" + v.toFixed(0);
              },
            },
          },
        },
      },
    });
  }

  function closeChartModal() {
    dom.chartModalBackdrop.style.display = "none";
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  /* ═══════════════ Data Loading ═══════════════ */
  async function loadBootstrap(silent = false) {
    const data = await apiGet("/api/bootstrap");

    state.stats = data.stats || state.stats;
    state.summaryRmb = data.summaryRmb || "0.00";
    state.performanceSummary = data.performanceSummary || {};
    state.accounts = data.accounts || [];
    state.accountPerformance = data.accountPerformance || [];
    state.recentSnapshots = data.recentSnapshots || [];
    state.trend = data.trend || [];

    await loadSnapshotData();

    renderCards();
    renderAccountSelect();
    renderHeroSparkline();
    renderAccountsTable();
    renderSnapshotsTable();

    if (!silent) {
      dom.statusText.textContent = "数据已更新";
    }
  }

  /* ═══════════════ Account CRUD ═══════════════ */
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
    if (!confirm("确认删除这条月度记录吗？")) return;
    await apiSend(`/api/snapshots/${id}`, "DELETE");
    showToast("记录已删除");
    await loadBootstrap(true);
  }

  async function onQuickSnapshotSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(dom.quickSnapshotForm).entries());
    await apiSend("/api/snapshots", "POST", payload);
    showToast("月度余额保存成功");

    const currentAccount = dom.quickSnapshotForm.elements.account_id.value;
    const currentMonth = dom.quickSnapshotForm.elements.snapshot_month.value || getCurrentMonth();
    dom.quickSnapshotForm.reset();
    dom.quickSnapshotForm.elements.account_id.value = currentAccount;
    dom.quickSnapshotForm.elements.snapshot_month.value = currentMonth;

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

  /* ═══════════════ Event Binding ═══════════════ */
  function bindEvents() {
    dom.refreshBtn.addEventListener("click", () => {
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
      /* Sparkline click → open chart modal */
      const sparklineCell = event.target.closest("td[data-action='show-chart']");
      if (sparklineCell) {
        const accountId = Number(sparklineCell.dataset.accountId);
        const accountName = sparklineCell.dataset.accountName;
        if (accountId) openChartModal(accountId, accountName);
        return;
      }

      /* Button actions */
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

    /* Chart modal close handlers */
    dom.chartModalClose.addEventListener("click", closeChartModal);
    dom.chartModalBackdrop.addEventListener("click", (e) => {
      if (e.target === dom.chartModalBackdrop) closeChartModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dom.chartModalBackdrop.style.display !== "none") {
        closeChartModal();
      }
    });
  }

  /* ═══════════════ Start ═══════════════ */
  async function start() {
    bindEvents();
    await loadBootstrap(true);
  }

  start().catch((error) => {
    showToast(error.message, "error");
    // eslint-disable-next-line no-console
    console.error(error);
  });
})();
