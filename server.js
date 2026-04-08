import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= RIO =================
async function pegarRio() {
  try {
    const { data } = await axios.get("https://www.deunoposte.com/", {
      timeout: 10000
    });

    const $ = cheerio.load(data);
    let resultados = [];

    $("table tr").each((i, el) => {
      const cols = $(el).find("td");

      if (cols.length >= 2) {
        resultados.push({
          posicao: $(cols[0]).text().trim(),
          numero: $(cols[1]).text().trim()
        });
      }
    });

    return resultados;

  } catch (e) {
    console.log("Erro Rio:", e.message);
    return [];
  }
}

// ================= LOOK GO =================
async function pegarLook() {
  try {
    const { data } = await axios.get("https://lookgoias.com/", {
      timeout: 10000
    });

    const $ = cheerio.load(data);
    let resultados = [];

    $("table tr").each((i, el) => {
      const cols = $(el).find("td");

      if (cols.length >= 2) {
        resultados.push({
          posicao: $(cols[0]).text().trim(),
          numero: $(cols[1]).text().trim()
        });
      }
    });

    return resultados;

  } catch (e) {
    console.log("Erro Look:", e.message);
    return [];
  }
}

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      { timeout: 10000 }
    );

    return data;

  } catch (e) {
    console.log("Erro Federal:", e.message);
    return [];
  }
}

// ================= CARREGAR TUDO =================
async function carregarTudo() {
  const agora = Date.now();

  // cache 60s
  if (cache && agora - tempo < 60000) {
    console.log("⚡ usando cache");
    return cache;
  }

  console.log("🔄 atualizando dados...");

  const [rio, look, federal] = await Promise.all([
    pegarRio(),
    pegarLook(),
    pegarFederal()
  ]);

  cache = {
    atualizado: new Date().toLocaleString(),
    rio,
    look,
    federal
  };

  tempo = agora;

  return cache;
}

// ================= ROTAS =================
app.get("/resultados", async (req, res) => {
  const dados = await carregarTudo();
  res.json(dados);
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    msg: "API REAL rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});