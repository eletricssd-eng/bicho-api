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

// ================= RESULTADO FACIL (AUTO DETECÇÃO) =================
async function pegarResultados() {
  try {
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $ = cheerio.load(data);

    const resultadoFinal = {};

    $("h2, h3").each((i, el) => {
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

      // ===== DETECTAR HORÁRIO =====
      let horario = "EXTRAÇÃO";

      const horariosPadrao = [
        "ptm", "pt", "ptv", "ptn",
        "coruja", "manhã", "tarde", "noite"
      ];

      for (let h of horariosPadrao) {
        if (titulo.includes(h)) {
          horario = h.toUpperCase();
          break;
        }
      }

      // ===== DETECTAR BANCA =====
      let banca = "outros";

      if (titulo.includes("rio")) banca = "rio";
      else if (titulo.includes("look")) banca = "look";
      else if (titulo.includes("nacional")) banca = "nacional";
      else if (titulo.includes("bahia")) banca = "bahia";
      else if (titulo.includes("goias")) banca = "goias";
      else if (titulo.includes("minas")) banca = "minas";

      if (!resultadoFinal[banca]) {
        resultadoFinal[banca] = [];
      }

      resultadoFinal[banca].push({
        horario,
        titulo: tituloOriginal,
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      });
    });

    return resultadoFinal;

  } catch (e) {
    console.log("Erro scraping:", e.message);
    return {};
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
    ...dadosSite,
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