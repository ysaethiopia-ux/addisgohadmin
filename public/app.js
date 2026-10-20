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

const imagePreview = createImagePreview();

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

  // Extremely short base64 payloads are usually test strings and not real images.
  return payload.length < 120;
}

function renderCell(column, rawValue, row) {
  const value = normalizeValue(rawValue);
  const safeValue = escapeHtml(value);

  if (isLikelyScreenshotColumn(column) && isImageUrl(value)) {
    const sourceUrl = value;
    const previewUrl =
      activeKey === "upgradeTransaction" && row?.id
        ? `/api/upgrade-transactions/${encodeURIComponent(row.id)}/screenshot`
        : sourceUrl;

    const safePreviewUrl = escapeHtml(previewUrl);
    const safeSourceUrl = escapeHtml(sourceUrl);
    const shortHint = isLikelyInvalidDataImage(value) ? " data-hint='invalid-data'" : "";
    return `
      <button type="button" class="image-preview-btn" data-image-url="${safePreviewUrl}" data-source-url="${safeSourceUrl}"${shortHint} title="Open screenshot preview">
        View screenshot
      </button>
    `;
  }

  return safeValue;
}

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

function renderTable(container, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = `<div class="empty">No records found.</div>`;
    return;
  }

  const columns = Object.keys(rows[0]);
  const headHtml = columns.map((column) => `<th>${column}</th>`).join("");

  const bodyHtml = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${renderCell(column, row[column], row)}</td>`).join("");
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

activeTableWrap.addEventListener("click", (event) => {
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
loadDashboard();
