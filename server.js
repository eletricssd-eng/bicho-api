import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= ORDEM =================
const ORDEM = ["09", "10", "11", "12", "14", "15", "16", "18", "19", "21"];

function ordenar(lista) {
  return lista.sort((a, b) =>
    ORDEM.indexOf(a.horario?.slice(0, 2)) -
    ORDEM.indexOf(b.horario?.slice(0, 2))
  );
}

// ================= CACHE =================
let cache = null;
let ultimaAtualizacao = 0;
const TEMPO_CACHE = 60000;

// ================= NORMALIZAR =================
function normalizar(data) {
  if (!Array.isArray(data)) return [];

  return data.map(item => ({
    banca: item.bank?.toLowerCase() || item.banca || "",
    horario: item.time || item.horario || "",
    resultados: (item.results || item.resultados || []).map(r => ({
      pos: r.position || r.pos,
      numero: r.number || r.numero,
      bicho: r.animal || r.bicho || ""
    }))
  }));
}

// ================= API =================
async function pegarViaAPI() {
  const APIS = [
    "https://bicho-api.onrender.com/resultados",
    "https://bicho-api.onrender.com/resultado"
  ];

  for (let url of APIS) {
    try {
      console.log("🔍 API:", url);

      const { data } = await axios.get(url, { timeout: 5000 });
      const dados = normalizar(data);

      if (dados.length > 0) {
        console.log("✅ API OK");
        return dados;
      }

    } catch (err) {
      console.log("❌ API falhou:", err.message);
    }
  }

  return [];
}

// ================= SCRAPING PRO =================
async function pegarViaScraping() {
  let browser;

  try {
    console.log("🧠 Scraping PRO iniciado...");

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process"
      ],
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage();

    await page.goto("https://www.resultadosdobicho.com/", {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const resultados = await page.evaluate(() => {
      const lista = [];

      document.querySelectorAll("li").forEach(el => {
        const texto = el.innerText;

        const match = texto.match(/(\d{1,2})º\s+(\d{4})/);

        if (match) {
          lista.push({
            banca: "geral",
            horario: "",
            resultados: [{
              pos: match[1],
              numero: match[2],
              bicho: ""
            }]
          });
        }
      });

      return lista;
    });

    await browser.close();

    if (resultados.length > 0) {
      console.log("✅ SCRAPING OK");
      return resultados;
    }

  } catch (err) {
    console.log("❌ ERRO PUPPETEER:", err.message);
  }

  if (browser) await browser.close();

  return [];
}

// ================= FALLBACK =================
async function pegarResultadosSeguro() {
  const api = await pegarViaAPI();
  if (api.length) return { fonte: "api", dados: api };

  const scrape = await pegarViaScraping();
  if (scrape.length) return { fonte: "scraping", dados: scrape };

  console.log("⚠️ USANDO MOCK");

  return {
    fonte: "mock",
    dados: []
  };
}

// ================= FILTRAR =================
function separar(dados) {
  return {
    rio: dados.filter(d => d.banca.includes("rio")),
    nacional: dados.filter(d => d.banca.includes("nacional")),
    look: dados.filter(d =>
      d.banca.includes("look") || d.banca.includes("goias")
    ),
    federal: dados.filter(d => d.banca.includes("federal"))
  };
}

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  try {
    const agora = Date.now();

    if (cache && agora - ultimaAtualizacao < TEMPO_CACHE) {
      return res.json(cache);
    }

    const resposta = await pegarResultadosSeguro();
    const dados = resposta.dados;

    console.log("📊 Fonte:", resposta.fonte);

    const separado = separar(dados);

    separado.rio = ordenar(separado.rio);
    separado.nacional = ordenar(separado.nacional);
    separado.look = ordenar(separado.look);
    separado.federal = ordenar(separado.federal);

    const final = {
      fonte: resposta.fonte,
      ...separado
    };

    cache = final;
    ultimaAtualizacao = agora;

    res.json(final);

  } catch (err) {
    console.log("🔥 ERRO GERAL:", err.message);
    res.status(500).json({ erro: "Falha na API" });
  }
});

// ================= TESTE =================
app.get("/", (req, res) => {
  res.send("API ONLINE 🚀");
});

// ================= START =================
app.listen(PORT, "0.0.0.0" () => {
  console.log("🚀 Rodando na porta " + PORT);
});