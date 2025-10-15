const form = document.querySelector("#searchForm");
const input = document.querySelector("#searchInput");
const results = document.querySelector("#results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  
  results.innerHTML = `<div class="loading">Searching "${q}"...</div>`;

  try {
    // Determine if this is a stock symbol search or industry search
    const isStockSymbol = /^[A-Z]{1,5}$/i.test(q) || q.length <= 5;
    
    let disc;
    if (isStockSymbol) {
      // Direct stock symbol search
      console.log("Searching for stock symbol:", q);
      const discResponse = await fetch(`/api/search-stock?q=${encodeURIComponent(q)}`);
      if (!discResponse.ok) {
        throw new Error(`Stock search failed: ${discResponse.status}`);
      }
      disc = await discResponse.json();
    } else {
      // Industry search using Wikidata
      console.log("Searching for industry:", q);
      const discResponse = await fetch(`/api/discover?q=${encodeURIComponent(q)}`);
      if (!discResponse.ok) {
        throw new Error(`Industry search failed: ${discResponse.status}`);
      }
      disc = await discResponse.json();
    }
    
    console.log("Discovered companies:", disc);
    let companies = disc.companies.filter(c => c.ticker).slice(0, 8);

    // If too few have tickers, try resolving a few by name using Finnhub
    if (companies.length < 6 && !isStockSymbol) {
      const noTicker = disc.companies.filter(c => !c.ticker).slice(0, 10);
      for (const c of noTicker) {
        try {
          const resolveResponse = await fetch(`/api/resolve?name=${encodeURIComponent(c.name)}`);
          if (resolveResponse.ok) {
            const matches = await resolveResponse.json();
            const best = matches.find(m => m.symbol && m.description?.toLowerCase().includes(c.name.toLowerCase()));
            if (best) companies.push({ ...c, ticker: best.symbol });
            if (companies.length >= 8) break;
          }
        } catch (err) {
          console.warn(`Failed to resolve ${c.name}:`, err);
        }
      }
    }

    if (companies.length === 0) {
      const searchType = isStockSymbol ? "stock symbol" : "industry";
      results.innerHTML = `<div class="error">No companies found for "${q}". Try searching for a ${searchType === "stock symbol" ? "different symbol like AAPL, MSFT, GOOGL" : "different industry like technology, healthcare, or finance"}.</div>`;
      return;
    }

    // Fetch detailed data using Polygon.io and Finnhub
    results.innerHTML = `<div class="loading">Loading stock data...</div>`;
    
    const cards = await Promise.all(companies.map(async c => {
      try {
        const cardResponse = await fetch(`/api/card/${c.ticker}`);
        if (!cardResponse.ok) {
          throw new Error(`Failed to fetch data for ${c.ticker}`);
        }
        const data = await cardResponse.json();
        return { meta: c, data };
      } catch (err) {
        console.warn(`Failed to fetch card for ${c.ticker}:`, err);
        return null;
      }
    }));

    const validCards = cards.filter(c => c !== null);
    
    if (validCards.length === 0) {
      results.innerHTML = `<div class="error">Found companies but couldn't load stock data. Please check your API keys.</div>`;
      return;
    }

    results.innerHTML = validCards.map(renderCard).join("");
    
  } catch (error) {
    console.error("Search error:", error);
    results.innerHTML = `<div class="error">Search failed: ${error.message}</div>`;
  }
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
