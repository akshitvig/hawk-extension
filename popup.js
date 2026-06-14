const API_BASE = "https://hawk-backend-production-0e18.up.railway.app"; // keep in sync with content.js — set to your deployed backend
const KEYS = { stats: "hawk_stats", paused: "hawk_paused", wallet: "hawk_wallet", install: "hawk_install_id" };

const todayKey = () => new Date().toISOString().slice(0, 10);
const fmtUsd = (n) => "$" + (n || 0).toFixed(n >= 100 ? 0 : 2);

function renderLocal(data) {
  const stats = data[KEYS.stats] || {};
  const today = (stats.days || {})[todayKey()] || { usd: 0 };
  const total = stats.total || { usd: 0 };
  document.getElementById("today-usd").textContent = fmtUsd(today.usd);
  document.getElementById("total-usd").textContent = fmtUsd(total.usd);

  const top = Object.entries(stats.byTicker || {})
    .filter(([t]) => t !== "*").sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) {
    document.getElementById("tickers").innerHTML = top
      .map(([t, n]) => `<b>${t}</b> ${n} impressions`).join("<br>");
  }
}

async function renderServer(installId) {
  try {
    const r = await fetch(`${API_BASE}/v1/me/${installId}`);
    if (!r.ok) return;
    const me = await r.json();
    // server truth replaces local estimates: today slot shows withdrawable, all-time shows lifetime
    document.getElementById("today-usd").textContent = fmtUsd(me.confirmedUsd);
    document.querySelector("#today-usd + .lbl").textContent = "Withdrawable";
    document.getElementById("total-usd").textContent = fmtUsd(me.pendingUsd + me.confirmedUsd + me.paidUsd);
    document.querySelector("#total-usd + .lbl").textContent = "Lifetime";
    if (me.topTickers?.length) {
      document.getElementById("tickers").innerHTML = me.topTickers
        .map((t) => `<b>${t.ticker}</b> ${t.n} impressions`).join("<br>");
    }
    if (me.wallet) document.getElementById("wallet").value = me.wallet;
  } catch (_) { /* offline → local estimates stand */ }
}

chrome.storage.local.get([KEYS.stats, KEYS.paused, KEYS.wallet, KEYS.install], (data) => {
  renderLocal(data);
  document.getElementById("enabled").checked = !data[KEYS.paused];
  if (data[KEYS.wallet]) document.getElementById("wallet").value = data[KEYS.wallet];
  if (API_BASE && data[KEYS.install]) renderServer(data[KEYS.install]);
});

document.getElementById("enabled").addEventListener("change", (e) => {
  chrome.storage.local.set({ [KEYS.paused]: !e.target.checked });
});

document.getElementById("wallet").addEventListener("change", async (e) => {
  const v = e.target.value.trim();
  chrome.storage.local.set({ [KEYS.wallet]: v });
  if (API_BASE && /^0x[a-fA-F0-9]{40}$/.test(v)) {
    chrome.storage.local.get(KEYS.install, async (d) => {
      if (!d[KEYS.install]) return;
      try {
        await fetch(`${API_BASE}/v1/me/${d[KEYS.install]}/wallet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: v }),
        });
      } catch (_) {}
    });
  }
});
