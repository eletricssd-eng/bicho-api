import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";


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
  try {
    console.log("🔍 Buscando API alternativa...");

    const { data } = await axios.get(
      "https://loteriascaixa-api.herokuapp.com/api/jogo-do-bicho",
      { timeout: 10000 }
    );

    if (!data || data.length === 0) return [];

    const resultados = data.map(item => ({
      banca: item.banca?.toLowerCase() || "geral",
      horario: item.horario || "",
      resultados: [
        {
          pos: "1",
          numero: item.dezena || "",
          bicho: item.bicho || ""
        }
      ]
    }));

    console.log("✅ API alternativa OK");
    return resultados;

  } catch (err) {
    console.log("❌ API alternativa falhou:", err.message);
    return [];
  }
}
// ================= SCRAPING PRO =================
async function pegarViaScraping() {
  try {
    console.log("🌐 Scraping via proxy...");

    const { data: html } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.resultadosdobicho.com/",
      { timeout: 10000 }
    );

    const $ = cheerio.load(html);

    let lista = [];

    $("li").each((i, el) => {
      const texto = $(el).text();

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

    if (lista.length > 0) {
      console.log("✅ SCRAPING PROXY OK");
      return lista;
    }

  } catch (err) {
    console.log("❌ ERRO SCRAPING:", err.message);
  }

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
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Rodando na porta " + PORT);
});