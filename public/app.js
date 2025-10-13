const form = document.querySelector("#searchForm");
const input = document.querySelector("#searchInput");
const results = document.querySelector("#results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  results.innerHTML = `<div class="loading">Searching “${q}”...</div>`;

  const disc = await fetch(`/api/discover?q=${encodeURIComponent(q)}`).then(r => r.json());
  let companies = disc.companies.filter(c => c.ticker).slice(0, 8);

  // If too few have tickers, try resolving a few by name
  if (companies.length < 6) {
    const noTicker = disc.companies.filter(c => !c.ticker).slice(0, 10);
    for (const c of noTicker) {
      const matches = await fetch(`/api/resolve?name=${encodeURIComponent(c.name)}`).then(r => r.json());
      const best = matches.find(m => m.symbol && m.description?.toLowerCase().includes(c.name.toLowerCase()));
      if (best) companies.push({ ...c, ticker: best.symbol });
      if (companies.length >= 8) break;
    }
  }

  // Fetch cards
  const cards = await Promise.all(companies.map(c =>
    fetch(`/api/card/${c.ticker}`).then(r => r.json()).then(data => ({ meta: c, data }))
  ));

  results.innerHTML = cards.map(renderCard).join("");
});

function renderCard({ meta, data }) {
  const p = data.profile || {};
  const q = data.quote || {};
  const prev = data.prev || {};
  const candles = data.candles || [];
  const div = (data.dividends || [])[0];

  const price = q.c ?? q.c?.toFixed?.(2) ?? "—";
  const change = q.dp != null ? `${q.dp.toFixed(2)}%` : "—";
  const logo = p.logo || "https://via.placeholder.com/40";
  const name = p.name || meta.name || meta.ticker || data.symbol;

  // tiny sparkline values
  const points = candles.map(c => c.c).join(",");
  const yesterdayClose = prev.c ?? "—";

  return `
  <div class="card">
    <div class="card-hd">
      <img class="logo" src="${logo}" alt="" />
      <div>
        <div class="name">${name} <span class="sym">${data.symbol}</span></div>
        <div class="sub">${p.finnhubIndustry || meta.industry || ""}</div>
      </div>
      <div class="price">
        <div class="now">$${price}</div>
        <div class="chg ${q.dp >= 0 ? "up" : "down"}">${change}</div>
      </div>
    </div>

    <div class="row">
      <div class="metric">
        <div class="label">Yesterday Close</div>
        <div class="val">$${yesterdayClose}</div>
      </div>
      <div class="metric">
        <div class="label">Dividend</div>
        <div class="val">${div ? `$${div.cash_amount} on ${div.pay_date}` : "—"}</div>
      </div>
    </div>

    <div class="spark" data-points="${points}">
      <!-- you can draw a tiny canvas/inline SVG later -->
    </div>

    <details class="learn">
      <summary>What does this mean?</summary>
      <ul>
        <li><b>Close:</b> last traded price from the previous trading day.</li>
        <li><b>% Change:</b> today vs yesterday’s close.</li>
        <li><b>Dividend:</b> cash paid per share; ex-date = must own before to receive.</li>
      </ul>
    </details>
  </div>`;
}
