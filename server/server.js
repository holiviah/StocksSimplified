import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.static(path.join(__dirname, '..', 'public'))); // serve public/

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const POLYGON_KEY = process.env.POLYGON_KEY;
const FINNHUB_KEY = process.env.FINNHUB_KEY;

// --- Helper
const j = (r) => r.json();

//Interest(Wikidata)
app.get("/api/discover", async (req, res) => {
  try {
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

    if (!r.ok) {
      throw new Error(`Wikidata API error: ${r.status}`);
    }

    const data = await j(r);

    const companies = (data.results?.bindings || []).map(b => ({
      name: b.companyLabel?.value,
      ticker: b.ticker?.value || null,
      exchange: b.exchangeLabel?.value || null,
      industry: b.industryLabel?.value || null
    }));

    //Tickers
    const map = new Map();
    for (const c of companies) {
      const key = (c.ticker || c.name).toLowerCase();
      if (!map.has(key) || (c.ticker && !map.get(key).ticker)) map.set(key, c);
    }
    
    res.json({ query: q, companies: Array.from(map.values()) });
  } catch (error) {
    console.error("Discover API error:", error);
    res.status(500).json({ error: "Failed to search companies", details: error.message });
  }
});

//Stock symbol search
app.get("/api/search-stock", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().toUpperCase();
    if (!q) return res.status(400).json({ error: "Missing q" });
    
    if (!FINNHUB_KEY) {
      throw new Error("FINNHUB_KEY not configured");
    }
    
    // Search for the stock symbol directly
    const searchResponse = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`);
    
    if (!searchResponse.ok) {
      throw new Error(`Finnhub API error: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    const results = searchData.result || [];
    
    // Filter for exact symbol matches or close matches
    const exactMatches = results.filter(r => r.symbol === q);
    const closeMatches = results.filter(r => 
      r.symbol.includes(q) || 
      r.description?.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 8);
    
    const companies = [...exactMatches, ...closeMatches].slice(0, 8).map(r => ({
      name: r.description || r.symbol,
      ticker: r.symbol,
      exchange: null,
      industry: null
    }));
    
    res.json({ query: q, companies });
  } catch (error) {
    console.error("Stock search API error:", error);
    res.status(500).json({ error: "Failed to search stock", details: error.message });
  }
});

//Company name search
app.get("/api/search-company", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing q" });
    
    if (!FINNHUB_KEY) {
      throw new Error("FINNHUB_KEY not configured");
    }
    
    //Search for company by name
    const searchResponse = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`);
    
    if (!searchResponse.ok) {
      throw new Error(`Finnhub API error: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    const results = searchData.result || [];
    
    // Filter for companies that match the name
    const companyMatches = results.filter(r => 
      r.description?.toLowerCase().includes(q.toLowerCase()) ||
      r.symbol?.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 8);
    
    const companies = companyMatches.map(r => ({
      name: r.description || r.symbol,
      ticker: r.symbol,
      exchange: null,
      industry: null
    }));
    
    res.json({ query: q, companies });
  } catch (error) {
    console.error("Company search API error:", error);
    res.status(500).json({ error: "Failed to search company", details: error.message });
  }
});

//Resolve via Finnhub search
app.get("/api/resolve", async (req, res) => {
  try {
    const name = (req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });
    
    if (!FINNHUB_KEY) {
      throw new Error("FINNHUB_KEY not configured");
    }
    
    const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(name)}&token=${FINNHUB_KEY}`);
    
    if (!r.ok) {
      throw new Error(`Finnhub API error: ${r.status}`);
    }
    
    const out = await j(r);
    res.json(out.result || []);
  } catch (error) {
    console.error("Resolve API error:", error);
    res.status(500).json({ error: "Failed to resolve company", details: error.message });
  }
});

//A card for one ticker
app.get("/api/card/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    if (!POLYGON_KEY || !FINNHUB_KEY) {
      throw new Error("API keys not configured");
    }

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
  } catch (error) {
    console.error("Card API error:", error);
    res.status(500).json({ error: "Failed to fetch stock data", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
}
export default app;
