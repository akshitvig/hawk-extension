/**
 * Hawk — content script
 * Injects a sponsored card into the dead zones of trading UIs.
 * Hard rules (reputation = everything):
 *   - never rendered over price action (corner overlay, user-draggable, position remembered)
 *   - zero animation on the ad itself
 *   - one tap to collapse, one toggle to pause everything
 */

(() => {
  if (window.__hawkInjected) return;
  window.__hawkInjected = true;

  const ROTATION_MS = 45_000;          // one impression = one 45s slot while tab is visible
  const REMOTE_CONFIG_URL = "";        // legacy static ads.json override (ignored if API_BASE set)
  const API_BASE = "https://hawk-backend-production-0e18.up.railway.app";                 // set to your deployed backend, e.g. "https://api.hawk.xyz" — turns on server ads + real earnings
  const FLUSH_MS = 5 * 60_000;         // how often queued events post to the backend
  const STORAGE_KEYS = {
    stats: "hawk_stats",
    pos: "hawk_card_pos",
    paused: "hawk_paused",
    collapsed: "hawk_collapsed"
  };

  // ---------- venue + ticker detection ----------

  function detectVenue() {
    const h = location.hostname;
    if (h.includes("hyperliquid")) return "hyperliquid";
    if (h.includes("tradingview")) return "tradingview";
    if (h.includes("binance")) return "binance";
    return "unknown";
  }

  function detectTicker() {
    const venue = detectVenue();
    const path = location.pathname;
    const title = document.title || "";

    if (venue === "hyperliquid") {
      // https://app.hyperliquid.xyz/trade/BTC
      const m = path.match(/\/trade\/([A-Za-z0-9_\-:]+)/);
      if (m) return clean(m[1]);
    }
    if (venue === "binance") {
      // /en/trade/BTC_USDT  or  /en/futures/BTCUSDT
      const m = path.match(/\/(?:trade|futures)\/([A-Za-z0-9_]+)/);
      if (m) return clean(m[1]);
    }
    if (venue === "tradingview") {
      // ?symbol=BINANCE:BTCUSDT  or title "BTCUSDT 104,000 ▲ — TradingView"
      const sp = new URLSearchParams(location.search).get("symbol");
      if (sp) return clean(sp.split(":").pop());
      const m = title.match(/([A-Z0-9]{2,15})(?:USD[TC]?|PERP)?\s/);
      if (m) return clean(m[1]);
    }
    // generic fallback from title
    const m = title.match(/\b([A-Z]{2,10})[\/\-_]?(?:USD[TC]?|PERP|USD)\b/);
    return m ? clean(m[1]) : "*";
  }

  function clean(sym) {
    return sym
      .toUpperCase()
      .replace(/[_\-:]/g, "")
      .replace(/(USDT|USDC|USD|PERP)$/g, "") || "*";
  }

  // ---------- ads ----------

  let ADS = [];

  const FALLBACK_ADS = [
    {
      id: "house-slot",
      advertiser: "HAWK",
      headline: "This slot is for sale.",
      body: "Advertisers bid per ticker. The trader watching this chart keeps 50% of the bid, in USDC.",
      cta: "Bid on this chart →",
      url: "https://example.com/advertise",
      tickers: ["*"],
      cpmUsd: 20,
      weight: 1
    },
    {
      id: "demo-basislabs",
      advertiser: "BASIS LABS (demo)",
      headline: "Funding eating your PnL? Hedge it.",
      body: "Demo creative. A funding-rate product bidding only on perp charts.",
      cta: "See demo",
      url: "https://example.com/demo",
      tickers: ["*"],
      cpmUsd: 35,
      weight: 2
    }
  ];

  async function loadAds() {
    if (REMOTE_CONFIG_URL) {
      try {
        const r = await fetch(REMOTE_CONFIG_URL, { cache: "no-store" });
        if (r.ok) {
          ADS = await r.json();
          return;
        }
      } catch (_) { /* fall through to bundled */ }
    }
    try {
      const r = await fetch(chrome.runtime.getURL("ads.json"));
      ADS = await r.json();
    } catch (_) {
      ADS = FALLBACK_ADS;
    }
    if (!Array.isArray(ADS) || !ADS.length) ADS = FALLBACK_ADS;
  }

  function pickAd(ticker) {
    const eligible = ADS.filter(
      (a) => a.tickers.includes("*") || a.tickers.includes(ticker)
    );
    if (!eligible.length) return null;
    // weighted random — weight doubles as "bid priority" in V1
    const total = eligible.reduce((s, a) => s + (a.weight || 1), 0);
    let roll = Math.random() * total;
    for (const a of eligible) {
      roll -= a.weight || 1;
      if (roll <= 0) return a;
    }
    return eligible[0];
  }

  // ---------- storage helpers ----------

  const store = {
    get: (keys) => new Promise((res) => chrome.storage.local.get(keys, res)),
    set: (obj) => new Promise((res) => chrome.storage.local.set(obj, res))
  };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- backend link (active when API_BASE is set) ----------

  let installId = null;
  let eventQueue = [];
  let lastServerFetch = 0;

  // Bridge to the service worker — content scripts can't hit http://localhost
  // from an https page, but the SW can. Falls back gracefully if unavailable.
  function hawkFetch(url, init) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "hawkFetch", url, init }, (resp) => {
          if (chrome.runtime.lastError || !resp) return resolve({ ok: false });
          resolve(resp);
        });
      } catch (_) { resolve({ ok: false }); }
    });
  }

  async function getInstallId() {
    if (installId) return installId;
    const { hawk_install_id } = await store.get("hawk_install_id");
    if (hawk_install_id) return (installId = hawk_install_id);
    installId = crypto.randomUUID();
    await store.set({ hawk_install_id: installId });
    return installId;
  }

  async function loadServerAds(ticker) {
    if (!API_BASE) return false;
    if (Date.now() - lastServerFetch < 5 * 60_000 && ADS.length) return true;
    const venue = detectVenue();
    const resp = await hawkFetch(`${API_BASE}/v1/ads?ticker=${encodeURIComponent(ticker)}&venue=${encodeURIComponent(venue)}`);
    if (resp.ok && resp.body) {
      try {
        const list = JSON.parse(resp.body);
        if (Array.isArray(list) && list.length) {
          ADS = list;
          lastServerFetch = Date.now();
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function queueEvent(ev) {
    eventQueue.push(ev);
    if (ev.kind === "click" || eventQueue.length >= 20) flushEvents();
  }

  async function flushEvents() {
    if (!API_BASE || !eventQueue.length) return;
    const events = eventQueue.splice(0, 50);
    const resp = await hawkFetch(`${API_BASE}/v1/impressions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: await getInstallId(), events }),
    });
    if (!resp.ok) {
      eventQueue.unshift(...events);
      if (eventQueue.length > 200) eventQueue.length = 200;
    }
  }

  async function recordImpression(ad, ticker, rate = 1) {
    const { [STORAGE_KEYS.stats]: stats = {} } = await store.get(STORAGE_KEYS.stats);
    const day = todayKey();
    stats.days = stats.days || {};
    stats.days[day] = stats.days[day] || { impressions: 0, usd: 0 };
    stats.days[day].impressions += 1;

    // CPM math: each rotation slot ≈ 1 impression. user share = 50%.
    // collapsed pill counts at half rate — less attention, smaller bid.
    const usd = ((ad.cpmUsd || 20) / 1000) * 0.5 * rate;
    stats.days[day].usd += usd;

    stats.total = stats.total || { impressions: 0, usd: 0 };
    stats.total.impressions += 1;
    stats.total.usd += usd;

    stats.byTicker = stats.byTicker || {};
    stats.byTicker[ticker] = (stats.byTicker[ticker] || 0) + 1;

    await store.set({ [STORAGE_KEYS.stats]: stats });
  }

  // ---------- UI ----------

  let shadowHost, root, cardEl, currentTicker = "*";

  function buildUI(savedPos, collapsed) {
    shadowHost = document.createElement("div");
    shadowHost.id = "hawk-host";
    // default: bottom strip across the viewport; user can drag to a corner if they prefer
    const useStrip = !savedPos;
    if (useStrip) {
      shadowHost.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        left: 0; right: 0; bottom: 0;
      `;
    } else {
      shadowHost.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        right: ${savedPos.right}px;
        bottom: ${savedPos.bottom}px;
      `;
    }
    document.documentElement.appendChild(shadowHost);
    root = shadowHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      /* Strip mode — full-width caption at bottom of viewport */
      .strip {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 12px; line-height: 1;
        background: rgba(15, 15, 15, 0.92);
        color: #e7e5e4;
        border-top: 1px solid rgba(255,255,255,0.08);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        padding: 9px 16px;
        display: flex; align-items: center; gap: 14px;
        cursor: default;
      }
      .strip .grip {
        color: #5f5d5b; cursor: grab; user-select: none;
        font-size: 10px; letter-spacing: 0.05em;
      }
      .strip .grip:active { cursor: grabbing; }
      .strip .label {
        font-size: 9.5px; letter-spacing: 0.18em;
        color: #6b6968; text-transform: uppercase; font-weight: 600;
        white-space: nowrap;
      }
      .strip .sep {
        color: #3a3938; font-size: 10px; user-select: none;
      }
      .strip .adlink {
        color: inherit; text-decoration: none;
        display: flex; align-items: center; gap: 10px;
        flex: 1; min-width: 0; overflow: hidden;
      }
      .strip .brand {
        color: #d4d4d4; font-weight: 600; letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .strip .copy {
        color: #a8a6a4; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .strip .cta {
        color: #d4d4d4; white-space: nowrap;
        text-decoration: underline; text-decoration-color: #4a4847;
        text-underline-offset: 3px;
      }
      .strip .adlink:hover .copy,
      .strip .adlink:hover .cta { color: #fafafa; }
      .strip .adlink:hover .cta { text-decoration-color: #a8a6a4; }
      .strip .meta {
        margin-left: auto; display: flex; align-items: center; gap: 12px;
        font-size: 9.5px; color: #5f5d5b; letter-spacing: 0.06em;
        white-space: nowrap;
      }
      .strip .meta .keep { color: #6b6968; }
      .strip .ctrl {
        background: none; border: none; color: #5f5d5b;
        font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 4px;
      }
      .strip .ctrl:hover { color: #d4d4d4; }
      .strip .hawk {
        font-weight: 700; color: #b8b6b4; letter-spacing: 0.12em;
        font-size: 10px;
      }

      /* Floating card mode — for when user drags away from the strip */
      .card {
        font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif;
        width: 290px;
        background: rgba(15, 15, 15, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        color: #e7e5e4;
      }
      .card .bar {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: grab; user-select: none;
      }
      .card .bar:active { cursor: grabbing; }
      .card .hawk {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-weight: 700; color: #b8b6b4; letter-spacing: 0.14em;
        font-size: 9.5px;
      }
      .card .label {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 9px; letter-spacing: 0.16em;
        color: #6b6968; text-transform: uppercase; flex: 1;
      }
      .card .ctrl {
        background: none; border: none; color: #5f5d5b;
        font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px;
      }
      .card .ctrl:hover { color: #d4d4d4; }
      .card .body {
        padding: 12px 14px 13px; display: block; text-decoration: none; color: inherit;
      }
      .card .brand {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 10px; color: #b8b6b4;
        letter-spacing: 0.12em; margin-bottom: 7px;
      }
      .card .headline {
        font-size: 13.5px; font-weight: 600; color: #fafafa;
        line-height: 1.35; margin-bottom: 5px;
      }
      .card .copy {
        font-size: 11.5px; color: #a8a6a4; line-height: 1.5;
        margin-bottom: 11px;
      }
      .card .footrow {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px;
      }
      .card .cta {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 11px; font-weight: 600;
        color: #fafafa;
        border-bottom: 1px solid #5f5d5b;
        padding-bottom: 1px;
      }
      .card .keep {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 9.5px; color: #5f5d5b; letter-spacing: 0.06em;
      }

      /* Collapsed pill — minimal mode */
      .pill {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 11px;
        background: rgba(15, 15, 15, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 4px; padding: 6px 10px;
        user-select: none;
        display: inline-flex; gap: 10px; align-items: center;
        max-width: 320px;
        margin: 0 18px 18px auto;
      }
      .pill a {
        color: #a8a6a4; text-decoration: none;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 240px;
      }
      .pill a b { color: #d4d4d4; font-weight: 600; }
      .pill a:hover { color: #fafafa; }
      .pill .hawk {
        font-weight: 700; color: #b8b6b4; letter-spacing: 0.12em;
        font-size: 9.5px;
      }
      .pill .sep { color: #3a3938; }
      .pill .expand {
        background: none; border: none; color: #5f5d5b;
        font-size: 11px; cursor: pointer; padding: 0 2px; line-height: 1;
      }
      .pill .expand:hover { color: #d4d4d4; }
      .hidden { display: none; }
    `;
    root.appendChild(style);

    cardEl = document.createElement("div");
    root.appendChild(cardEl);

    renderCard(null, collapsed);
    enableDrag();
  }

  function isStripMode() {
    // strip when host is full-width pinned to bottom (no `right` style set)
    return shadowHost && (!shadowHost.style.right || shadowHost.style.right === "");
  }

  function renderCard(ad, collapsed) {
    if (!ad) ad = pickAd(currentTicker);

    // Collapsed pill — minimal mode
    if (collapsed) {
      if (!ad) { cardEl.innerHTML = `<span class="pill"><span class="hawk">HAWK</span></span>`; return; }
      cardEl.innerHTML = `
        <span class="pill" title="Sponsored — you keep 50%">
          <span class="hawk">HAWK</span><span class="sep">·</span>
          <a href="${encodeURI(ad.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(ad.advertiser)}</b> · ${escapeHtml(ad.headline)}</a>
          <button class="expand" id="expand" title="Expand">⌃</button>
        </span>`;
      cardEl.querySelector(".pill a").addEventListener("click", () => {
        queueEvent({ campaignId: ad.id, kind: "click", ticker: currentTicker, venue: detectVenue(), mode: "collapsed" });
      });
      cardEl.querySelector("#expand").addEventListener("click", async (e) => {
        e.stopPropagation();
        await store.set({ [STORAGE_KEYS.collapsed]: false });
        renderCard(ad, false);
      });
      return;
    }

    if (!ad) { cardEl.innerHTML = ""; return; }

    // Strip mode — wire-service caption across the bottom (default)
    if (isStripMode()) {
      cardEl.innerHTML = `
        <div class="strip">
          <span class="grip" id="drag" title="Drag to detach into a corner">⋮⋮</span>
          <span class="hawk">HAWK</span>
          <span class="sep">·</span>
          <span class="label">Sponsored · ${escapeHtml(currentTicker)}</span>
          <a class="adlink" href="${encodeURI(ad.url)}" target="_blank" rel="noopener noreferrer">
            <span class="brand">${escapeHtml(ad.advertiser)}</span>
            <span class="sep">·</span>
            <span class="copy">${escapeHtml(ad.headline)}</span>
            <span class="sep">·</span>
            <span class="cta">${escapeHtml(ad.cta)} →</span>
          </a>
          <span class="meta">
            <span class="keep">you keep 50%</span>
            <button class="ctrl" id="min" title="Collapse">–</button>
          </span>
        </div>`;
      cardEl.querySelector(".adlink").addEventListener("click", () => {
        queueEvent({ campaignId: ad.id, kind: "click", ticker: currentTicker, venue: detectVenue(), mode: "full" });
      });
      cardEl.querySelector("#min").addEventListener("click", async (e) => {
        e.stopPropagation();
        await store.set({ [STORAGE_KEYS.collapsed]: true });
        renderCard(ad, true);
      });
      return;
    }

    // Floating card mode — when user has dragged it off the strip
    cardEl.innerHTML = `
      <div class="card">
        <div class="bar" id="drag">
          <span class="hawk">HAWK</span>
          <span class="label">Sponsored · ${escapeHtml(currentTicker)}</span>
          <button class="ctrl" id="min" title="Collapse">–</button>
        </div>
        <a class="body" href="${encodeURI(ad.url)}" target="_blank" rel="noopener noreferrer">
          <div class="brand">${escapeHtml(ad.advertiser)}</div>
          <div class="headline">${escapeHtml(ad.headline)}</div>
          <div class="copy">${escapeHtml(ad.body)}</div>
          <div class="footrow">
            <span class="cta">${escapeHtml(ad.cta)} →</span>
            <span class="keep">you keep 50%</span>
          </div>
        </a>
      </div>`;
    cardEl.querySelector(".body").addEventListener("click", () => {
      queueEvent({ campaignId: ad.id, kind: "click", ticker: currentTicker, venue: detectVenue(), mode: "full" });
    });
    cardEl.querySelector("#min").addEventListener("click", async (e) => {
      e.stopPropagation();
      await store.set({ [STORAGE_KEYS.collapsed]: true });
      renderCard(ad, true);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function enableDrag() {
    let startX, startY, startRight, startBottom, dragging = false, wasStrip = false;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (wasStrip) {
        // first move: detach strip into floating card at the cursor
        shadowHost.style.left = "auto";
        shadowHost.style.right = Math.max(0, window.innerWidth - e.clientX - 40) + "px";
        shadowHost.style.bottom = Math.max(0, window.innerHeight - e.clientY - 20) + "px";
        wasStrip = false;
        // re-render as a card now that we're no longer in strip mode
        renderCard(null, false);
      } else {
        shadowHost.style.right = Math.max(0, startRight - dx) + "px";
        shadowHost.style.bottom = Math.max(0, startBottom - dy) + "px";
      }
    };
    const onUp = async () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      // only persist position if we ended up floating
      if (shadowHost.style.right && shadowHost.style.right !== "") {
        await store.set({
          [STORAGE_KEYS.pos]: {
            right: parseInt(shadowHost.style.right, 10),
            bottom: parseInt(shadowHost.style.bottom, 10),
          },
        });
      }
    };
    root.addEventListener("pointerdown", (e) => {
      const bar = e.composedPath().find((el) => el.id === "drag");
      if (!bar) return;
      dragging = true;
      wasStrip = isStripMode();
      startX = e.clientX;
      startY = e.clientY;
      startRight = parseInt(shadowHost.style.right, 10) || 18;
      startBottom = parseInt(shadowHost.style.bottom, 10) || 86;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // ---------- main loop ----------

  async function tick() {
    const flags = await store.get([STORAGE_KEYS.paused, STORAGE_KEYS.collapsed]);
    if (flags[STORAGE_KEYS.paused]) {
      if (shadowHost) shadowHost.style.display = "none";
      return;
    }
    if (shadowHost) shadowHost.style.display = "";

    currentTicker = detectTicker();
    await loadServerAds(currentTicker);
    const collapsed = !!flags[STORAGE_KEYS.collapsed];
    const ad = pickAd(currentTicker);
    renderCard(ad, collapsed);

    // an impression only counts when the tab is actually being watched.
    // full card = 1x, collapsed pill = 0.5x (subtle mode, smaller bid)
    if (ad && document.visibilityState === "visible") {
      await recordImpression(ad, currentTicker, collapsed ? 0.5 : 1);
      queueEvent({
        campaignId: ad.id,
        kind: "impression",
        ticker: currentTicker,
        venue: detectVenue(),
        mode: collapsed ? "collapsed" : "full",
      });
    }
  }

  async function init() {
    await loadAds();
    const saved = await store.get([STORAGE_KEYS.pos, STORAGE_KEYS.collapsed, STORAGE_KEYS.paused]);
    buildUI(saved[STORAGE_KEYS.pos], !!saved[STORAGE_KEYS.collapsed]);
    await tick();
    setInterval(tick, ROTATION_MS);
    setInterval(flushEvents, FLUSH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushEvents();
    });

    // react instantly when popup toggles pause
    chrome.storage.onChanged.addListener((changes) => {
      if (STORAGE_KEYS.paused in changes) tick();
    });
  }

  init();
})();
