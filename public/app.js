const form = document.querySelector("#searchForm");
const input = document.querySelector("#searchInput");
const results = document.querySelector("#results");
const popularList = document.querySelector("#popularList");
const clearBtn = document.querySelector("#clearBtn");
const modal = document.querySelector('#modal');
const modalClose = document.querySelector('#modalClose');
const modalContent = document.querySelector('#modalContent');

// Preload a few popular tickers on homepage
const POPULAR = [
  { ticker: "AAPL", name: "Apple Inc" },
  { ticker: "MSFT", name: "Microsoft Corp" },
  { ticker: "GOOGL", name: "Alphabet Inc Class A" },
  { ticker: "AMZN", name: "Amazon.com Inc" }
];

if (popularList) {
  popularList.innerHTML = POPULAR.map(p => `
    <li>
      <div class="ticker">${p.ticker}</div>
      <div class="name">${p.name}</div>
      <button data-ticker="${p.ticker}">View</button>
    </li>
  `).join("");

  popularList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-ticker]");
    if (!btn) return;
    input.value = btn.dataset.ticker;
    form.dispatchEvent(new Event("submit"));
  });
}

function showHome() {
  input.value = "";
  results.innerHTML = "";
  document.querySelector(".popular")?.classList.remove("hidden");
  clearBtn?.classList.add("hidden");
  document.querySelector('#searchBtn')?.classList.remove('hidden');
}

clearBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  showHome();
});

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

    // Deduplicate by ticker before proceeding
    {
      const seen = new Set();
      companies = companies.filter(c => {
        const t = c.ticker && String(c.ticker).toUpperCase();
        if (!t) return false;
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      }).slice(0, 8);
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
    document.querySelector(".popular")?.classList.add("hidden");
    // Replace search icon with X on the right
    clearBtn?.classList.remove("hidden");
    document.querySelector('#searchBtn')?.classList.add('hidden');
    
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

    
  </div>`;
}

// Open modal when a card is clicked
results.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const symEl = card.querySelector('.sym');
  const symbol = symEl ? symEl.textContent.trim() : null;
  if (!symbol) return;
  const points = card.querySelector('.spark')?.getAttribute('data-points') || '';
  openModal(symbol, points);
});

modalClose?.addEventListener('click', closeModal);
modal?.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) closeModal();
});

function closeModal() {
  modal?.classList.add('hidden');
  modalContent.innerHTML = '';
}

function openModal(symbol, pointsCSV) {
  const points = pointsCSV.split(',').map(v => Number(v)).filter(v => !Number.isNaN(v));
  modalContent.innerHTML = renderModal(symbol, points);
  modal?.classList.remove('hidden');
}

function renderModal(symbol, closes) {
  if (!closes || closes.length === 0) {
    return `<div class="pad"><b>${symbol}</b><div>No chart data available.</div></div>`;
  }
  const w = 800, h = 320, pad = 30;
  const min = Math.min(...closes), max = Math.max(...closes);
  const x = (i) => pad + (i / (closes.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const d = closes.map((v,i) => `${i===0?'M':'L'}${x(i)},${y(v)}`).join(' ');
  const area = `M${x(0)},${y(closes[0])} ` + closes.map((v,i)=>`L${x(i)},${y(v)}`).join(' ') + ` L${x(closes.length-1)},${h-pad} L${x(0)},${h-pad} Z`;
  const last = closes[closes.length-1];
  return `
  <div class="pad">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-weight:800;font-size:18px;">${symbol}</div>
      <div style="color:#5b5b5b;">Last: $${last.toFixed(2)}</div>
    </div>
  </div>
  <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#22c55e" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="${pad}" y="${pad}" width="${w-pad*2}" height="${h-pad*2}" fill="#fafafa" stroke="#eee" />
    <path d="${area}" fill="url(#grad)" stroke="none"/>
    <path d="${d}" fill="none" stroke="#16a34a" stroke-width="2"/>
  </svg>`;
}
