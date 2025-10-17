const form = document.querySelector("#searchForm");
const input = document.querySelector("#searchInput");
const results = document.querySelector("#results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  
  results.innerHTML = `<div class="loading">Searching "${q}"...</div>`;

  try {
    // Determine search type based on input
    const isStockSymbol = /^[A-Z]{1,5}$/i.test(q) && q.length <= 5;
    const isCompanyName = /^[A-Za-z\s&.,-]+$/.test(q) && q.length > 3 && !isStockSymbol;
    
    let disc;
    if (isStockSymbol) {
      // Direct stock symbol search
      console.log("Searching for stock symbol:", q);
      const discResponse = await fetch(`/api/search-stock?q=${encodeURIComponent(q)}`);
      if (!discResponse.ok) {
        throw new Error(`Stock search failed: ${discResponse.status}`);
      }
      disc = await discResponse.json();
    } else if (isCompanyName) {
      // Company name search
      console.log("Searching for company name:", q);
      const discResponse = await fetch(`/api/search-company?q=${encodeURIComponent(q)}`);
      if (!discResponse.ok) {
        throw new Error(`Company search failed: ${discResponse.status}`);
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
    if (companies.length < 6 && !isStockSymbol && !isCompanyName) {
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
      let suggestion = "";
      if (isStockSymbol) {
        suggestion = "different symbol like AAPL, MSFT, GOOGL";
      } else if (isCompanyName) {
        suggestion = "different company name like Apple, Microsoft, Tesla";
      } else {
        suggestion = "different industry like technology, healthcare, or finance";
      }
      results.innerHTML = `<div class="error">No companies found for "${q}". Try searching for a ${suggestion}.</div>`;
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

    // Only keep cards with usable market data
    const displayable = validCards.filter(({ data }) => {
      const q = data.quote || {};
      const prev = data.prev || {};
      const candles = Array.isArray(data.candles) ? data.candles : [];
      const hasQuote = q.c != null;
      const hasPrev = prev && prev.c != null;
      const hasCandles = candles.length > 0;
      return hasQuote || hasPrev || hasCandles;
    });

    if (displayable.length === 0) {
      results.innerHTML = `<div class=\"error\">Found companies but none had sufficient market data to display. Try a different query or check API limits.</div>`;
      return;
    }

    results.innerHTML = displayable.map(renderCard).join("");
    
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

  const lastCandleClose = candles.length ? candles[candles.length - 1]?.c : null;
  const rawPrice = (q.c != null) ? q.c : (lastCandleClose != null ? lastCandleClose : (prev?.c != null ? prev.c : null));
  const price = rawPrice != null ? Number(rawPrice).toFixed(2) : "—";

  const prevCloseVal = (prev?.c != null)
    ? Number(prev.c)
    : (q?.pc != null)
      ? Number(q.pc)
      : (lastCandleClose != null)
        ? Number(lastCandleClose)
        : null;
  let changeNum = null;
  if (q.dp != null) {
    changeNum = Number(q.dp);
  } else if (rawPrice != null && prevCloseVal != null && prevCloseVal !== 0) {
    changeNum = ((Number(rawPrice) - prevCloseVal) / prevCloseVal) * 100;
  }
  const change = changeNum != null ? `${changeNum.toFixed(2)}%` : "—";
  const logo = p.logo || "https://via.placeholder.com/40";
  const name = p.name || meta.name || meta.ticker || data.symbol;

  // tiny sparkline values
  const points = candles.map(c => c.c).join(",");
  const yesterdayClose = prevCloseVal != null ? Number(prevCloseVal).toFixed(2) : "—";

  return `
  <div class="card">
    <div class="card-hd">
      <div>
        <div class="name">${name} <span class="sym">${data.symbol}</span></div>
        <div class="sub">${p.finnhubIndustry || meta.industry || ""}</div>
      </div>
      <div class="price">
        <div class="now">$${price}</div>
        <div class="chg ${changeNum == null ? "" : (changeNum >= 0 ? "up" : "down")}">${change}</div>
      </div>
      <img class="logo" src="${logo}" alt="" />
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
        <li><b>Dividend:</b> cash paid per share, ex-date = must own before to receive.</li>
      </ul>
    </details>
  </div>`;
}
