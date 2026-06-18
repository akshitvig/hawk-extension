# ◎ Hawk

**Get paid to watch the tape.**

Hawk shows one quiet sponsored card in the unused space at the bottom of your trading
screen — and pays you half of every dollar it earns, in USDC.

It never covers your chart. It never animates. You can drag it, collapse it to a pill,
or dismiss it. That's the whole product.

Works on **Hyperliquid**, **TradingView**, and **Binance**.

---

## Why this exists

Perp traders stare at charts for hours. That attention is some of the most valuable in
crypto — and right now it's worth nothing to the person actually doing the watching.

Hawk changes that. Advertisers (protocols, vaults, trading tools) bid to show a single
sponsored line to traders. The highest bid serves first. Half of every dollar goes to
the trader whose screen showed the card, paid in USDC.

No banner soup. No pop-ups. One line, in the dead zone, clearly labeled.

---

## Install (60 seconds)

Hawk isn't on the Chrome Web Store yet (review pending). Until then, you can load it
directly — it takes about a minute.

1. **Download** the latest `hawk-extension.zip` from the
   [Releases page](../../releases) and unzip it. You'll get a folder called
   `hawk-extension`.
2. Open Chrome (or Brave, Arc, Edge — anything Chromium) and go to `chrome://extensions`
3. Turn on **Developer mode** (toggle, top-right)
4. Click **Load unpacked** (top-left)
5. Select the unzipped `hawk-extension` folder
6. Open [Hyperliquid](https://app.hyperliquid.xyz/trade) — within a few seconds, a
   sponsored card appears in the empty space below the chart

That's it. To earn, click the Hawk icon in your toolbar and paste a USDC wallet address
(any EVM chain) where you want payouts sent.

### Updating
Since this is a direct install (not the store yet), updates are manual: download the
newer release, unzip over the old folder, and click the refresh icon on the Hawk card
in `chrome://extensions`. Once we're on the Web Store, updates will be automatic.

---

## How it works

- A single sponsored card loads in the unused area at the bottom of the chart.
- It rotates every 45 seconds. One card per slot.
- Hawk counts how many cards were shown **while the tab was visible** (no background
  farming) and credits your account a 50% revenue share.
- Earnings settle in USDC to the payout address you set. Estimates show in the popup
  until a slot settles.
- Hard caps per install bound abuse and keep the marketplace honest.

---

## What Hawk does NOT do

This extension sits on financial sites, so it's worth being explicit:

- **No wallet access.** Hawk never requests a wallet connection, never asks for a
  signature, and never touches your funds. The only wallet info involved is a payout
  address *you* choose to enter, used solely to send you your earnings.
- **No trade data.** It does not read or transmit your trades, positions, balances,
  orders, or account details.
- **No tracking elsewhere.** It only runs on the supported trading sites listed above —
  nowhere else.
- **No remote code.** All scripts are bundled in this repo. Nothing is fetched and run
  at runtime except the sponsored card text from Hawk's auction API.

The code in this repo *is* the code that runs. Read it. That's the point of shipping it
open.

---

## Permissions, explained

| Permission | Why |
|------------|-----|
| `storage` | Stores an anonymous install ID, your card-shown count, your display preferences, and your optional payout address — all locally. |
| `app.hyperliquid.xyz`, `*.tradingview.com`, `www.binance.com` | So Hawk can place its card in the unused space on these specific sites. It reads the market symbol from the URL to keep the card relevant. Nothing else on the page is read or sent. |
| Hawk API (`*.up.railway.app`) | Hawk's own backend — fetches the current sponsored card and reports an anonymous count of cards shown so your revenue share can be calculated. |

Full privacy policy: https://gethawk.xyz/privacy.html

---

## For advertisers

Want to reach perp traders on the charts they never stop watching? You can target a
specific ticker (e.g. only HYPE chart-watchers) or run network-wide. Bids start low and
the highest bid serves first.

Create a campaign at the Hawk portal: https://gethawk.xyz/#/advertise

---

## Status

Hawk is early. The auction is live, payouts are real, and the marketplace works
end-to-end. Expect rough edges. Feedback and issues welcome — open an
[issue](../../issues) or reach out.

Get paid to watch the tape. ◎
