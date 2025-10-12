// This file contains the JavaScript code for the application. It handles fetching stock data from the API, updating the DOM with stock information, and managing user interactions such as searching for stocks and displaying sector data.

const API_KEY = "V5vGcVpvKmXETDXr8N0KfgCDHQRnvIQM"; // dev only; use proxy for production
const P = (path, params={}) => {
  const url = new URL(`https://api.polygon.io${path}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  url.searchParams.set("apiKey", API_KEY);
  return url.toString();
};

const fmt = (n, d=2) => Number(n).toLocaleString(undefined, {maximumFractionDigits:d, minimumFractionDigits:d});
const pct = (n) => (n>=0?'+':'') + (100*n).toFixed(2) + '%';
const safe = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function rowHTML({ticker, name, changePercent, lastPrice}) {
  const up = changePercent >= 0;
  return `
    <div class="row" data-ticker="${ticker}">
      <div class="sym">${safe(ticker)}</div>
      <div class="name">${safe(name || '')}</div>
      <div class="chg ${up?'up':'down'}">${fmt(lastPrice ?? 0, 2)} &nbsp; ${up? '▲':'▼'} ${Math.abs(changePercent*100).toFixed(2)}%</div>
    </div>
  `;
}

function mountList(el, items) {
  el.innerHTML = items.map(rowHTML).join('') || `<div class="muted sml">No data.</div>`;
  Array.from(el.querySelectorAll('.row')).forEach(r => {
    r.addEventListener('click', () => loadTicker(r.dataset.ticker));
  });
}

async function getGainers() {
  const res = await fetch(P('/v2/snapshot/locale/us/markets/stocks/gainers'));
  const json = await res.json();
  return (json?.tickers || []).slice(0,6).map(t => ({
    ticker: t.ticker,
    name: t?.name || t?.ticker,
    changePercent: t.todaysChangePct/100,
    lastPrice: t.lastTrade?.p ?? t.min?.o ?? 0
  }));
}

async function getActive() {
  try{
    const res = await fetch(P('/v2/snapshot/locale/us/markets/stocks/most-active'));
    const json = await res.json();
    const arr = json?.tickers || [];
    if (!arr.length) throw new Error('empty');
    return arr.slice(0,6).map(t => ({
      ticker: t.ticker,
      name: t?.name || t?.ticker,
      changePercent: t.todaysChangePct/100,
      lastPrice: t.lastTrade?.p ?? t.min?.o ?? 0
    }));
  } catch {
    return [];
  }
}

async function searchTickers(q) {
  const res = await fetch(P('/v3/reference/tickers', { search: q, active: 'true', limit: 8 }));
  const json = await res.json();
  return (json?.results || []).map(r => ({ ticker: r.ticker, name: r.name }));
}

async function getTickerSnapshot(ticker) {
  const res = await fetch(P(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`));
  return await res.json();
}

async function getSectorTop(sector) {
  const res = await fetch(P('/v3/reference/tickers', {
    market: 'stocks',
    active: 'true',
    limit: 50,
    sector: sector
  }));
  const json = await res.json();
  const arr = (json?.results || [])
    .sort((a,b) => (b.market_cap||0) - (a.market_cap||0))
    .slice(0,6);
  const enriched = await Promise.all(arr.map(async r => {
    try{
      const s = await getTickerSnapshot(r.ticker);
      const t = s?.ticker || s?.results || s;
      const chg = t?.todaysChangePct ?? t?.ticker?.todaysChangePct ?? 0;
      const price = t?.lastTrade?.p ?? 0;
      return {ticker:r.ticker, name:r.name, changePercent:(chg/100), lastPrice: price};
    }catch{ return {ticker:r.ticker, name:r.name, changePercent:0, lastPrice:0}; }
  }));
  return enriched;
}

const gainersEl = document.getElementById('gainers');
const activeEl = document.getElementById('active');
const popularEl = document.getElementById('popular');
const autoEl = document.getElementById('autoResults');
const selectedEl = document.getElementById('selected');
const searchInput = document.getElementById('search');

const POPULAR = ["AAPL","MSFT","NVDA","AMZN","GOOGL","SPY"];

function mountPopular() {
  popularEl.innerHTML = POPULAR.map(t => `
    <div class="row" data-ticker="${t}">
      <div class="sym">${t}</div>
      <div class="name muted">Popular</div>
      <div class="chg">View</div>
    </div>
  `).join('');
  Array.from(popularEl.querySelectorAll('.row')).forEach(r=>{
    r.addEventListener('click',()=>loadTicker(r.dataset.ticker));
  });
}

async function loadHome() {
  mountPopular();
  try{
    const [g, a] = await Promise.all([getGainers(), getActive()]);
    mountList(gainersEl, g);
    mountList(activeEl, a);
  }catch(e){
    console.error(e);
    gainersEl.innerHTML = `<div class="muted sml">Couldn’t load market data.</div>`;
    activeEl.innerHTML = `<div class="muted sml">Couldn’t load activity.</div>`;
  }
}

async function loadTicker(ticker) {
  selectedEl.style.display = 'block';
  selectedEl.innerHTML = `<div class="muted sml">Loading ${ticker}…</div>`;
  try{
    const s = await getTickerSnapshot(ticker);
    const t = s?.ticker || s?.results || s;
    const name = t?.name || ticker;
    const price = t?.lastTrade?.p ?? 0;
    const prevClose = t?.prevDay?.c ?? 0;
    const chg = prevClose ? (price - prevClose)/prevClose : (t?.todaysChangePct ?? 0)/100;
    selectedEl.innerHTML = `
      <div class="ticker-header">
        <div class="pill">${safe(ticker)}</div>
        <h2 style="margin:0">${safe(name)}</h2>
      </div>
      <div class="price" style="margin:6px 0 2px">${fmt(price,2)}</div>
      <div class="${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'} ${Math.abs(chg*100).toFixed(2)}%</div>
      <div class="grid" style="margin-top:10px">
        <div><span class="sml muted">Prev Close</span><br>${fmt(prevClose,2)}</div>
        <div><span class="sml muted">52W Range</span><br>${fmt(t?.fiftyTwoWeek?.low ?? 0,2)} – ${fmt(t?.fiftyTwoWeek?.high ?? 0,2)}</div>
      </div>
    `;
  }catch(e){
    console.error(e);
    selectedEl.innerHTML = `<div class="muted sml">Couldn’t load ${ticker}.</div>`;
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

let searchDebounce;
searchInput.addEventListener('input', e=>{
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (!q){ autoEl.style.display='none'; autoEl.innerHTML=''; return; }
  searchDebounce = setTimeout(async ()=>{
    const items = await searchTickers(q);
    autoEl.style.display='block';
    autoEl.innerHTML = items.map(r=>`
      <div class="row" data-ticker="${r.ticker}">
        <div class="sym">${r.ticker}</div>
        <div class="name">${safe(r.name)}</div>
        <div class="chg">Select</div>
      </div>
    `).join('') || `<div class="muted sml">No matches.</div>`;
    Array.from(autoEl.querySelectorAll('.row')).forEach(r=>{
      r.addEventListener('click',()=>{
        searchInput.value = r.dataset.ticker; autoEl.style.display='none'; loadTicker(r.dataset.ticker);
      });
    });
  }, 220);
});
document.getElementById('searchBtn').addEventListener('click', ()=>{
  const q = searchInput.value.trim();
  if (q) loadTicker(q.toUpperCase());
});

const sectorEl = document.getElementById('sectorResults');
document.querySelectorAll('.chip').forEach(chip=>{
  chip.addEventListener('click', async ()=>{
    const sector = chip.dataset.sector;
    sectorEl.innerHTML = `<div class="muted sml">Loading ${sector}…</div>`;
    const items = await getSectorTop(sector);
    mountList(sectorEl, items);
  });
});

loadHome();