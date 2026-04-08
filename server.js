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

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const sorteio = data.listaSorteios?.[0];

    if (!sorteio || !sorteio.dezenas || sorteio.dezenas.length < 5)
      return [];

    return [{
      horario: "Federal",
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

// ================= RESULTADO FACIL (TUDO) =================
async function pegarResultados() {
  try {
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $ = cheerio.load(data);

    const resultadoFinal = {
      rio: [],
      look: [],
      nacional: []
    };

    $("h3").each((i, el) => {
      const tituloOriginal = $(el).text().trim();
      const titulo = tituloOriginal.toLowerCase();

      const tabela = $(el).next("table");
      if (!tabela.length) return;

      const nums = [];

      tabela.find("tr").each((i, tr) => {
        const texto = $(tr).text();
        const match = texto.match(/\d{4}/);

        if (match) nums.push(match[0]);
      });

      if (nums.length < 5) return;

      const item = {
        horario: tituloOriginal,
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      };

      // ===== SEPARAÇÃO AUTOMÁTICA =====
      if (titulo.includes("rio")) {
        resultadoFinal.rio.push(item);
      } else if (titulo.includes("look")) {
        resultadoFinal.look.push(item);
      } else if (titulo.includes("nacional")) {
        resultadoFinal.nacional.push(item);
      }
    });

    return resultadoFinal;

  } catch (e) {
    console.log("Erro scraping:", e.message);
    return { rio: [], look: [], nacional: [] };
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

  const dadosSite = await pegarResultados();
  const federal = await pegarFederal();

  cache = {
    atualizado: new Date().toLocaleString(),
    rio: dadosSite.rio,
    look: dadosSite.look,
    nacional: dadosSite.nacional,
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