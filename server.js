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

// ================= SCRAPER PADRÃO =================
async function scraperBanca(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const resultados = [];

    $("h2, h3").each((i, el) => {
      const titulo = $(el).text().trim();

      const tabela = $(el).nextAll("table").first();
      if (!tabela.length) return;

      const nums = [];

      tabela.find("tr").each((i, tr) => {
        const texto = $(tr).text();
        const match = texto.match(/\d{4}/);

        if (match) nums.push(match[0]);
      });

      if (nums.length >= 5) {
        resultados.push({
          horario: titulo,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }
    });

    return resultados;

  } catch (e) {
    console.log("Erro scraping:", url);
    return [];
  }
}

// ================= BANCAS =================
async function pegarBancas() {

  const resultado = {
    rio: [],
    look: [],
    nacional: []
  };

  // LOOK
  resultado.look = await scraperBanca(
    "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"
  );

  // NACIONAL
  resultado.nacional = await scraperBanca(
    "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"
  );

  // RIO (CORRIGIDO)
  resultado.rio = await scraperBanca(
    "https://www.resultadofacil.com.br/resultado-do-jogo-do-bicho-rio"
  );

  return resultado;
}

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const res = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      }
    );

    const dados = res.data;

    if (!dados || !dados.listaSorteios) return [];

    const sorteio = dados.listaSorteios[0];

    if (!sorteio || !sorteio.dezenas) return [];

    return [{
      horario: "Federal",
      data: sorteio.dataApuracao,
      p1: sorteio.dezenas[0],
      p2: sorteio.dezenas[1],
      p3: sorteio.dezenas[2],
      p4: sorteio.dezenas[3],
      p5: sorteio.dezenas[4]
    }];

  } catch (e) {
    console.log("Erro Federal:", e.message);
    return [];
  }
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ cache");
    return cache;
  }

  console.log("🔄 atualizando...");

  const bancas = await pegarBancas();
  const federal = await pegarFederal();

  cache = {
    atualizado: new Date().toLocaleString(),
    ...bancas,
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
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});