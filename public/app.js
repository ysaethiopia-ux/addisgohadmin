const cards = document.getElementById("cards");
const refreshBtn = document.getElementById("refreshBtn");
const navItems = Array.from(document.querySelectorAll(".nav-item"));

const leadCountEl = document.getElementById("leadCount");
const eventCountEl = document.getElementById("eventCount");
const transactionCountEl = document.getElementById("transactionCount");
const activeTitleEl = document.getElementById("activeTitle");
const activeCountEl = document.getElementById("activeCount");
const activeTableWrap = document.getElementById("activeTableWrap");

const tableMeta = {
  funnelLead: { label: "FunnelLead", countEl: leadCountEl },
  funnelEvent: { label: "FunnelEvent", countEl: eventCountEl },
  upgradeTransaction: { label: "UpgradeTransaction", countEl: transactionCountEl }
};

let activeKey = "funnelLead";
let state = {
  funnelLead: { data: [], count: 0 },
  funnelEvent: { data: [], count: 0 },
  upgradeTransaction: { data: [], count: 0 }
};

function renderCards(totals) {
  const cardData = [
    { label: "Total Leads", value: totals.funnelLead ?? 0 },
    { label: "Lead Events", value: totals.funnelEvent ?? 0 },
    { label: "Upgrade Submissions", value: totals.upgradeTransaction ?? 0 }
  ];

  cards.innerHTML = cardData
    .map(
      (item, index) => `
      <article class="card" style="animation-delay:${index * 0.08}s">
        <h3>${item.label}</h3>
        <p>${Number(item.value).toLocaleString()}</p>
      </article>
    `
    )
    .join("");
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderTable(container, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = `<div class="empty">No records found.</div>`;
    return;
  }

  const columns = Object.keys(rows[0]);
  const headHtml = columns.map((column) => `<th>${column}</th>`).join("");

  const bodyHtml = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${normalizeValue(row[column])}</td>`).join("");
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
  container.innerHTML = `<div class="error">${message}</div>`;
}

function setActiveNav(nextKey) {
  activeKey = nextKey;
  navItems.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.key === nextKey);
  });
  renderActiveTable();
}

function renderActiveTable() {
  const meta = tableMeta[activeKey];
  const selected = state[activeKey] || { data: [], count: 0 };

  activeTitleEl.textContent = meta.label;
  activeCountEl.textContent = `${selected.count || 0} rows`;
  renderTable(activeTableWrap, selected.data || []);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Request failed");
  }
  return payload;
}

async function loadDashboard() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";

  try {
    const [overview, leads, events, transactions] = await Promise.all([
      fetchJson("/api/overview"),
      fetchJson("/api/funnel-leads?limit=100"),
      fetchJson("/api/funnel-events?limit=100"),
      fetchJson("/api/upgrade-transactions?limit=100")
    ]);

    renderCards(overview.totals || {});

    state = {
      funnelLead: { data: leads.data || [], count: leads.count || 0 },
      funnelEvent: { data: events.data || [], count: events.count || 0 },
      upgradeTransaction: { data: transactions.data || [], count: transactions.count || 0 }
    };

    leadCountEl.textContent = String(leads.count || 0);
    eventCountEl.textContent = String(events.count || 0);
    transactionCountEl.textContent = String(transactions.count || 0);

    renderActiveTable();
  } catch (error) {
    cards.innerHTML = `<article class="card"><h3>Connection</h3><p>Failed</p></article>`;
    renderError(activeTableWrap, error.message);
    activeCountEl.textContent = "0 rows";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Data";
  }
}

navItems.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveNav(button.dataset.key);
  });
});

refreshBtn.addEventListener("click", loadDashboard);
loadDashboard();
