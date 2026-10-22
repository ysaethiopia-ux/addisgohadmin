const cards = document.getElementById("cards");
const refreshBtn = document.getElementById("refreshBtn");
const navItems = Array.from(document.querySelectorAll(".nav-item"));

const leadCountEl = document.getElementById("leadCount");
const eventCountEl = document.getElementById("eventCount");
const transactionCountEl = document.getElementById("transactionCount");
const analyticsCountEl = document.getElementById("analyticsCount");
const activeTitleEl = document.getElementById("activeTitle");
const activeSubtitleEl = document.getElementById("activeSubtitle");
const activeCountEl = document.getElementById("activeCount");
const activeTableWrap = document.getElementById("activeTableWrap");
const marketingAnalyticsWrap = document.getElementById("marketingAnalyticsWrap");
const analyticsFilterBar = document.getElementById("analyticsFilterBar");
const timezoneBadge = document.getElementById("timezoneBadge");
const presetBtns = Array.from(document.querySelectorAll(".preset-btn"));
const customDateForm = document.getElementById("customDateForm");
const startDateInput = document.getElementById("startDateInput");
const endDateInput = document.getElementById("endDateInput");

// Auth Elements
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const adminPasscodeInput = document.getElementById("adminPasscodeInput");
const authErrorMsg = document.getElementById("authErrorMsg");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const logoutBtn = document.getElementById("logoutBtn");

let activeKey = "marketingAnalytics"; // Default to Lead Tracking
let activePreset = "all";
let currentStartDateIso = null;
let currentEndDateIso = null;

let state = {
  marketingAnalytics: null,
  funnelLead: { data: [], count: 0 },
  funnelEvent: { data: [], count: 0 },
  upgradeTransaction: { data: [], count: 0 }
};

const tableMeta = {
  marketingAnalytics: {
    label: "Lead Tracking & Funnel Analytics",
    subtitle: "Real-time channel attribution and conversion rates across Instagram, Facebook, and Direct traffic.",
    countEl: analyticsCountEl
  },
  funnelLead: {
    label: "FunnelLead Records",
    subtitle: "Raw lead submissions from the marketing funnel Join Now form.",
    countEl: leadCountEl
  },
  funnelEvent: {
    label: "FunnelEvent Telemetry",
    subtitle: "Granular lead interaction events (e.g., clicks, downloads, registration completions).",
    countEl: eventCountEl
  },
  upgradeTransaction: {
    label: "UpgradeTransaction Submissions",
    subtitle: "Payment submissions, receipts, and verification statuses.",
    countEl: transactionCountEl
  }
};

const imagePreview = createImagePreview();

// Detect and display client timezone
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
if (timezoneBadge) {
  timezoneBadge.textContent = `Timezone: ${userTimezone}`;
}

// --- TIMEZONE & FULL-DAY BOUNDARY HELPERS ---

function getUtcRangeForLocalDate(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function getUtcRangeForPreset(preset) {
  const now = new Date();
  if (preset === "today") {
    return getUtcRangeForLocalDate(now);
  }
  if (preset === "yesterday") {
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return getUtcRangeForLocalDate(yest);
  }
  if (preset === "7d") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  if (preset === "30d") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  // All Time
  return { startIso: null, endIso: null };
}

function getUtcRangeForCustom(startVal, endVal) {
  let startIso = null;
  let endIso = null;

  if (startVal) {
    const [y, m, d] = startVal.split("-").map(Number);
    const s = new Date(y, m - 1, d, 0, 0, 0, 0);
    startIso = s.toISOString();
  }
  if (endVal) {
    const [y, m, d] = endVal.split("-").map(Number);
    const e = new Date(y, m - 1, d, 23, 59, 59, 999);
    endIso = e.toISOString();
  }

  return { startIso, endIso };
}

// --- AUTHENTICATION HANDLING ---

function showAuthModal() {
  authModal.hidden = false;
  adminPasscodeInput.value = "";
  authErrorMsg.hidden = true;
  adminPasscodeInput.focus();
}

function hideAuthModal() {
  authModal.hidden = true;
  authErrorMsg.hidden = true;
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = adminPasscodeInput.value.trim();
  if (!password) return;

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Verifying...";
  authErrorMsg.hidden = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Authentication failed");
    }

    hideAuthModal();
    loadDashboard();
  } catch (err) {
    authErrorMsg.textContent = err.message || "Invalid passcode";
    authErrorMsg.hidden = false;
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = "Unlock Dashboard";
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    showAuthModal();
  }
});

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    showAuthModal();
    throw new Error("AUTH_REQUIRED");
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }
  return payload;
}

// --- RENDERING HELPERS ---

function normalizeValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(num) {
  if (num === null || num === undefined) return "—";
  return Number(num).toLocaleString();
}

function formatDate(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_e) {
    return isoString;
  }
}

function isLikelyScreenshotColumn(column) {
  return /screenshot|image|receipt|proof/i.test(column);
}

function isImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isLikelyInvalidDataImage(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:image/")) return false;

  const parts = raw.split(",");
  if (parts.length < 2) return true;
  const payload = parts[1] || "";
  return payload.length < 120;
}

function renderCell(column, rawValue, row) {
  const value = normalizeValue(rawValue);
  const safeValue = escapeHtml(value);

  if (isLikelyScreenshotColumn(column) && isImageUrl(value)) {
    const sourceUrl = value;
    const previewUrl =
      row?.id ? `/api/upgrade-transactions/${encodeURIComponent(row.id)}/screenshot` : sourceUrl;

    const safePreviewUrl = escapeHtml(previewUrl);
    const safeSourceUrl = escapeHtml(sourceUrl);
    const shortHint = isLikelyInvalidDataImage(value) ? " data-hint='invalid-data'" : "";
    return `
      <button type="button" class="image-preview-btn" data-image-url="${safePreviewUrl}" data-source-url="${safeSourceUrl}"${shortHint} title="Open screenshot preview">
        View screenshot
      </button>
    `;
  }

  if (column === "source") {
    return renderChannelBadge(rawValue);
  }

  if (column === "status") {
    return `<span class="status-pill status-${escapeHtml(String(rawValue).toLowerCase())}">${safeValue}</span>`;
  }

  if (column === "createdAt" || column === "updatedAt") {
    return formatDate(rawValue);
  }

  return safeValue;
}

function renderChannelBadge(channel) {
  const raw = String(channel || "direct_other").toLowerCase();
  if (raw.includes("instagram") || raw.includes("ig")) {
    return `<span class="channel-badge channel-instagram">Instagram</span>`;
  }
  if (raw.includes("facebook") || raw.includes("fb")) {
    return `<span class="channel-badge channel-facebook">Facebook</span>`;
  }
  return `<span class="channel-badge channel-direct">Direct / Other</span>`;
}

// --- MARKETING ANALYTICS CARDS & TABLE ---

function renderMarketingCards(analytics) {
  const total = analytics?.channels?.total || {};
  const hasSessions = analytics?.trafficSessionAvailable;

  const cardData = [
    {
      label: "Tracked Link Clicks",
      sub: "ClickEvent records",
      value: formatNumber(total.clicks ?? 0),
      color: "brand"
    },
    {
      label: "Unique Visitors",
      sub: hasSessions ? "Distinct visitor IDs" : "Pending TrafficSession",
      value: hasSessions ? formatNumber(total.uniqueVisitors) : "—",
      color: "muted"
    },
    {
      label: "Total Visits",
      sub: hasSessions ? "Browsing sessions" : "Pending TrafficSession",
      value: hasSessions ? formatNumber(total.totalVisits) : "—",
      color: "muted"
    },
    {
      label: "New Registered Leads",
      sub: "FunnelLead.createdAt",
      value: formatNumber(total.newRegisteredLeads ?? 0),
      color: "accent"
    },
    {
      label: "Registration Events",
      sub: "FunnelEvent (all events)",
      value: formatNumber(analytics?.registrationEventsCount ?? 0),
      color: "accent"
    },
    {
      label: "Upgrade Submissions",
      sub: "UpgradeTransaction records",
      value: formatNumber(total.upgradeSubmissions ?? 0),
      color: "ink"
    },
    {
      label: "Confirmed Upgrades",
      sub: "Status APPROVED/CONFIRMED",
      value: formatNumber(total.confirmedUpgrades ?? 0),
      color: "ok"
    }
  ];

  cards.className = "cards cards--analytics";
  cards.innerHTML = cardData
    .map(
      (item, index) => `
      <article class="card card--${item.color}" style="animation-delay:${index * 0.04}s">
        <h3>${item.label}</h3>
        <p>${item.value}</p>
        <span class="card-meta">${item.sub}</span>
      </article>
    `
    )
    .join("");
}

function renderOverviewCards(totals) {
  const cardData = [
    { label: "Total Funnel Leads", value: totals.funnelLead ?? 0, sub: "All time records in DB" },
    { label: "Funnel Events", value: totals.funnelEvent ?? 0, sub: "Interaction telemetry" },
    { label: "Upgrade Submissions", value: totals.upgradeTransaction ?? 0, sub: "Receipts submitted" }
  ];

  cards.className = "cards cards--overview";
  cards.innerHTML = cardData
    .map(
      (item, index) => `
      <article class="card" style="animation-delay:${index * 0.08}s">
        <h3>${item.label}</h3>
        <p>${Number(item.value).toLocaleString()}</p>
        <span class="card-meta">${item.sub}</span>
      </article>
    `
    )
    .join("");
}

function renderMarketingAnalyticsView(analytics) {
  if (!analytics) {
    marketingAnalyticsWrap.innerHTML = `<div class="empty">No analytics data available.</div>`;
    return;
  }

  const { channels, trafficSessionAvailable, recentActivity } = analytics;
  const list = [channels.instagram, channels.facebook, channels.direct_other, channels.total];

  let migrationNoticeHtml = "";
  if (!trafficSessionAvailable) {
    migrationNoticeHtml = `
      <div class="migration-notice">
        <div class="migration-notice__icon">ℹ</div>
        <div class="migration-notice__content">
          <strong>TrafficSession table is not yet migrated in Neon.</strong>
          <span>Link clicks (ClickEvent), New registered leads (FunnelLead.source), and Upgrade Submissions (UpgradeTransaction.source) are actively tracking real database values. Unique visitors and sessions will automatically populate once TrafficSession is added.</span>
        </div>
      </div>
    `;
  }

  const tableRowsHtml = list
    .map((row) => {
      const isTotal = row.channel === "total";
      const trClass = isTotal ? "table-row--total" : "";
      const channelLabel = isTotal
        ? `<strong>Total</strong>`
        : renderChannelBadge(row.channel);

      const uniqueVisitorsDisplay = trafficSessionAvailable
        ? formatNumber(row.uniqueVisitors)
        : `<span class="pending-text" title="TrafficSession model not yet in database">—</span>`;
      const visitsDisplay = trafficSessionAvailable
        ? formatNumber(row.totalVisits)
        : `<span class="pending-text" title="TrafficSession model not yet in database">—</span>`;

      return `
        <tr class="${trClass}">
          <td>${channelLabel}</td>
          <td><strong>${formatNumber(row.clicks)}</strong></td>
          <td>${uniqueVisitorsDisplay}</td>
          <td>${visitsDisplay}</td>
          <td><strong class="metric-leads">${formatNumber(row.newRegisteredLeads)}</strong></td>
          <td><strong>${formatNumber(row.upgradeSubmissions)}</strong></td>
          <td><strong class="metric-confirmed">${formatNumber(row.confirmedUpgrades)}</strong></td>
          <td><span class="rate-badge">${row.leadToSubmissionRate}%</span></td>
        </tr>
      `;
    })
    .join("");

  // Recent Leads Table
  const leads = recentActivity?.leads || [];
  const leadsRowsHtml = leads.length
    ? leads
        .map(
          (l) => `
        <tr>
          <td>${escapeHtml(l.fullName || "-")}</td>
          <td>${escapeHtml(l.phone || "-")}</td>
          <td>${renderChannelBadge(l.source)}</td>
          <td><span class="status-pill status-${escapeHtml(String(l.status).toLowerCase())}">${escapeHtml(l.status)}</span></td>
          <td>${formatDate(l.createdAt)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No attributed leads in this timeframe.</td></tr>`;

  // Recent Transactions Table
  const txs = recentActivity?.transactions || [];
  const txRowsHtml = txs.length
    ? txs
        .map(
          (t) => `
        <tr>
          <td>${escapeHtml(t.firstName || "")} ${escapeHtml(t.lastName || "")}</td>
          <td>${renderChannelBadge(t.source)}</td>
          <td>${escapeHtml(t.paymentMethod || "-")}</td>
          <td><span class="status-pill status-${escapeHtml(String(t.status).toLowerCase())}">${escapeHtml(t.status)}</span></td>
          <td>${formatDate(t.createdAt)}</td>
          <td>${renderCell("screenshotUrl", t.id, t)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="6" class="empty">No upgrade submissions in this timeframe.</td></tr>`;

  marketingAnalyticsWrap.innerHTML = `
    ${migrationNoticeHtml}

    <div class="analytics-section">
      <div class="section-title-wrap">
        <h3>Channel Performance Comparison</h3>
        <span class="section-note">Metrics aggregated across marketing channels</span>
      </div>
      <div class="table-wrap">
        <table class="source-comparison-table">
          <thead>
            <tr>
              <th>Marketing Channel</th>
              <th>Link Clicks</th>
              <th>Unique Visitors</th>
              <th>Total Visits</th>
              <th>New Registered Leads</th>
              <th>Upgrade Submissions</th>
              <th>Confirmed Upgrades</th>
              <th>Lead → Upgrade Rate</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    </div>

    <div class="attribution-grid">
      <div class="attribution-card">
        <div class="section-title-wrap">
          <h4>Recent Leads Attributed</h4>
          <span class="pill">${leads.length} recent</span>
        </div>
        <div class="table-wrap subtable-wrap">
          <table>
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Phone</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              ${leadsRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <div class="attribution-card">
        <div class="section-title-wrap">
          <h4>Recent Upgrade Submissions</h4>
          <span class="pill">${txs.length} recent</span>
        </div>
        <div class="table-wrap subtable-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Channel</th>
                <th>Method</th>
                <th>Status</th>
                <th>Submitted At</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              ${txRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderTable(container, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = `<div class="empty">No records found.</div>`;
    return;
  }

  const columns = Object.keys(rows[0]);
  const headHtml = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");

  const bodyHtml = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${renderCell(column, row[column], row)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

function renderError(container, message) {
  container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function setActiveNav(nextKey) {
  activeKey = nextKey;
  navItems.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.key === nextKey);
  });
  renderActiveView();
}

function renderActiveView() {
  const meta = tableMeta[activeKey] || tableMeta.marketingAnalytics;
  activeTitleEl.textContent = meta.label;
  if (activeSubtitleEl) {
    activeSubtitleEl.textContent = meta.subtitle || "";
  }

  if (activeKey === "marketingAnalytics") {
    analyticsFilterBar.hidden = false;
    marketingAnalyticsWrap.hidden = false;
    activeTableWrap.hidden = true;
    activeCountEl.textContent = "Live attribution";

    renderMarketingCards(state.marketingAnalytics);
    renderMarketingAnalyticsView(state.marketingAnalytics);
  } else {
    analyticsFilterBar.hidden = true;
    marketingAnalyticsWrap.hidden = true;
    activeTableWrap.hidden = false;

    const selected = state[activeKey] || { data: [], count: 0 };
    activeCountEl.textContent = `${selected.count || 0} rows`;

    // Overview cards
    if (state.overviewTotals) {
      renderOverviewCards(state.overviewTotals);
    }
    renderTable(activeTableWrap, selected.data || []);
  }
}

// --- DATA FETCHING ---

async function fetchMarketingAnalytics(startDateIso, endDateIso) {
  let url = "/api/analytics/marketing";
  const params = [];
  if (startDateIso) params.push(`startDate=${encodeURIComponent(startDateIso)}`);
  if (endDateIso) params.push(`endDate=${encodeURIComponent(endDateIso)}`);
  if (params.length) url += `?${params.join("&")}`;

  const payload = await fetchJson(url);
  return payload;
}

async function loadDashboard() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";

  try {
    const range =
      activePreset === "custom"
        ? getUtcRangeForCustom(startDateInput.value, endDateInput.value)
        : getUtcRangeForPreset(activePreset);

    currentStartDateIso = range.startIso;
    currentEndDateIso = range.endIso;

    const [overview, analytics, leads, events, transactions] = await Promise.all([
      fetchJson("/api/overview"),
      fetchMarketingAnalytics(currentStartDateIso, currentEndDateIso),
      fetchJson("/api/funnel-leads?limit=100"),
      fetchJson("/api/funnel-events?limit=100"),
      fetchJson("/api/upgrade-transactions?limit=100")
    ]);

    state = {
      overviewTotals: overview.totals || {},
      marketingAnalytics: analytics,
      funnelLead: { data: leads.data || [], count: leads.count || 0 },
      funnelEvent: { data: events.data || [], count: events.count || 0 },
      upgradeTransaction: { data: transactions.data || [], count: transactions.count || 0 }
    };

    leadCountEl.textContent = String(leads.count || 0);
    eventCountEl.textContent = String(events.count || 0);
    transactionCountEl.textContent = String(transactions.count || 0);
    if (analyticsCountEl) {
      analyticsCountEl.textContent = "Live";
    }

    renderActiveView();
  } catch (error) {
    if (error.message === "AUTH_REQUIRED") return;
    cards.innerHTML = `<article class="card"><h3>Connection</h3><p>Failed</p><span class="card-meta">${escapeHtml(error.message)}</span></article>`;
    if (activeKey === "marketingAnalytics") {
      renderError(marketingAnalyticsWrap, error.message);
    } else {
      renderError(activeTableWrap, error.message);
    }
    activeCountEl.textContent = "Error";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Data";
  }
}

// --- PRESET & FILTER LISTENERS ---

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    presetBtns.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");

    activePreset = btn.dataset.preset;
    startDateInput.value = "";
    endDateInput.value = "";

    loadDashboard();
  });
});

customDateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  presetBtns.forEach((b) => b.classList.remove("is-active"));
  activePreset = "custom";
  loadDashboard();
});

navItems.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveNav(button.dataset.key);
  });
});

// Image preview modal handler
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const previewButton = target.closest(".image-preview-btn");
  if (!previewButton) return;

  const url = previewButton.getAttribute("data-image-url");
  if (!url) return;

  const sourceUrl = previewButton.getAttribute("data-source-url") || "";
  const hint = previewButton.getAttribute("data-hint") || "";
  imagePreview.open(url, hint, sourceUrl);
});

refreshBtn.addEventListener("click", loadDashboard);

// Screenshot Preview Component
function createImagePreview() {
  const overlay = document.createElement("div");
  overlay.className = "image-preview";
  overlay.innerHTML = `
    <div class="image-preview__backdrop" data-close-preview="true"></div>
    <figure class="image-preview__dialog" role="dialog" aria-modal="true" aria-label="Screenshot preview">
      <button type="button" class="image-preview__close" data-close-preview="true" aria-label="Close preview">Close</button>
      <img class="image-preview__img" alt="Screenshot preview" />
      <div class="image-preview__error" hidden>
        <p class="image-preview__error-text">Unable to load screenshot. This URL may be private or invalid.</p>
        <a class="image-preview__source" href="#" target="_blank" rel="noopener noreferrer">Open source URL</a>
      </div>
    </figure>
  `;

  document.body.appendChild(overlay);

  const imageEl = overlay.querySelector(".image-preview__img");
  const errorEl = overlay.querySelector(".image-preview__error");
  const sourceEl = overlay.querySelector(".image-preview__source");

  let currentUrl = "";

  function close() {
    overlay.classList.remove("is-open");
    imageEl.removeAttribute("src");
    errorEl.hidden = true;
    imageEl.hidden = false;
    currentUrl = "";
  }

  function showError() {
    imageEl.hidden = true;
    errorEl.hidden = false;
    sourceEl.href = currentUrl || "#";
  }

  function open(url, hint, sourceUrl) {
    currentUrl = (url || "").trim();
    errorEl.hidden = true;
    imageEl.hidden = false;
    sourceEl.href = (sourceUrl || currentUrl || "#").trim();

    if (!currentUrl || hint === "invalid-data" || isLikelyInvalidDataImage(currentUrl)) {
      imageEl.removeAttribute("src");
      showError();
      overlay.classList.add("is-open");
      return;
    }

    imageEl.src = currentUrl;
    overlay.classList.add("is-open");
  }

  imageEl.addEventListener("error", () => {
    showError();
  });

  imageEl.addEventListener("load", () => {
    errorEl.hidden = true;
    imageEl.hidden = false;
  });

  overlay.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.hasAttribute("data-close-preview")) {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  return { open, close };
}

// Initial load
loadDashboard();
