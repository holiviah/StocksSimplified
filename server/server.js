import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
dotenv.config();

const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, '..', 'public'))); // serve public/

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));

const POLYGON_KEY = process.env.POLYGON_KEY;
const FINNHUB_KEY = process.env.FINNHUB_KEY;

// --- Helper
const j = (r) => r.json();

// 1) Interest → companies (Wikidata)
app.get("/api/discover", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing q" });

  const sparql = `
  SELECT ?company ?companyLabel ?ticker ?exchangeLabel ?industryLabel WHERE {
    ?company wdt:P31/wdt:P279* wd:Q891723 .
    ?company wdt:P452 ?industry .
    ?industry rdfs:label ?industryLabel .
    FILTER(CONTAINS(LCASE(?industryLabel), LCASE("${q.replace(/"/g, '\\"')}")))
    ?company wdt:P414 ?exchange .
    OPTIONAL { ?company wdt:P249 ?ticker . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 60`;

  const r = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/sparql-results+json",
      "User-Agent": "stocks-simplified-demo"
    },
    body: new URLSearchParams({ format: "json", query: sparql })
  });
  const data = await j(r);

  const companies = (data.results?.bindings || []).map(b => ({
    name: b.companyLabel?.value,
    ticker: b.ticker?.value || null,
    exchange: b.exchangeLabel?.value || null,
    industry: b.industryLabel?.value || null
  }));

  // De-dup; keep entries with tickers first
  const map = new Map();
  for (const c of companies) {
    const key = (c.ticker || c.name).toLowerCase();
    if (!map.has(key) || (c.ticker && !map.get(key).ticker)) map.set(key, c);
  }
  res.json({ query: q, companies: Array.from(map.values()) });
});

// 2) If a company has no ticker, try to resolve via Finnhub search
app.get("/api/resolve", async (req, res) => {
  const name = (req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });
  const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(name)}&token=${FINNHUB_KEY}`);
  const out = await j(r);
  res.json(out.result || []);
});

// 3) Aggregate a “card” for one ticker
app.get("/api/card/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const [profileR, quoteR, prevR, rangeR, divR] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`).then(j),
    fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`).then(j),
    fetch(`https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?apiKey=${POLYGON_KEY}`).then(j),
    // last 30 days daily
    (async () => {
      const today = new Date();
      const from = new Date(today); from.setDate(today.getDate() - 30);
      const toISO = (d) => d.toISOString().slice(0,10);
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${toISO(from)}/${toISO(today)}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`;
      return fetch(url).then(j);
    })(),
    fetch(`https://api.polygon.io/v3/reference/dividends?ticker=${symbol}&limit=3&apiKey=${POLYGON_KEY}`).then(j)
  ]);

  res.json({
    symbol,
    profile: profileR,
    quote: quoteR,
    prev: prevR?.results?.[0] || null,
    candles: rangeR?.results || [],
    dividends: divR?.results || []
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
