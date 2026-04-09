import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= ARQUIVO =================
const HISTORICO_FILE = "./historico.json";

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= SCRAPER =================
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

  } catch {
    return [];
  }
}

// ================= BANCAS =================
async function pegarBancas() {
  return {
    // 🟥 RIO (NOVO LINK)
    rio: await scraperBanca(
      "https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"
    ),

    // 🟢 LOOK
    look: await scraperBanca(
      "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"
    ),

    // 🟡 NACIONAL
    nacional: await scraperBanca(
      "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"
    )
  };
}

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/resultado-banca-federal",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $ = cheerio.load(data);

    let resultado = null;

    $("h2, h3").each((i, el) => {
      const titulo = $(el).text().trim();

      // só pega bloco da federal
      if (!titulo.toLowerCase().includes("federal")) return;

      const tabela = $(el).nextAll("table").first();
      if (!tabela.length) return;

      const nums = [];

      tabela.find("tr").each((i, tr) => {
        const texto = $(tr).text();
        const match = texto.match(/\d{4}/);

        if (match) nums.push(match[0]);
      });

      if (nums.length >= 5 && !resultado) {
        resultado = {
          horario: titulo,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        };
      }
    });

    // ✅ se achou no site, retorna só 1
    if (resultado) return [resultado];

  } catch (e) {
    console.log("Erro Federal site:", e.message);
  }

  // ================= FALLBACK API =================
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

    const sorteio = res.data.listaSorteios?.[0];

    if (!sorteio || !sorteio.dezenas) return [];

    return [{
      horario: `Federal ${sorteio.dataApuracao}`,
      p1: sorteio.dezenas[0],
      p2: sorteio.dezenas[1],
      p3: sorteio.dezenas[2],
      p4: sorteio.dezenas[3],
      p5: sorteio.dezenas[4]
    }];

  } catch (e) {
    console.log("Erro Federal API:", e.message);
    return [];
  }
}

// ================= HISTÓRICO =================
function salvarHistorico(dadosHoje) {
  let historico = {};

  if (fs.existsSync(HISTORICO_FILE)) {
    historico = JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }

  const hoje = new Date().toISOString().split("T")[0];
  historico[hoje] = dadosHoje;

  const datas = Object.keys(historico).sort().reverse().slice(0, 7);

  const novo = {};
  datas.forEach(d => novo[d] = historico[d]);

  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(novo, null, 2));
}

function lerHistorico() {
  if (!fs.existsSync(HISTORICO_FILE)) return {};
  return JSON.parse(fs.readFileSync(HISTORICO_FILE));
}

// ================= ANÁLISE =================
function analisar(historico) {
  const contagem = {};

  Object.values(historico).forEach(dia => {
    ["rio", "look", "nacional"].forEach(banca => {
      (dia[banca] || []).forEach(res => {
        [res.p1, res.p2, res.p3, res.p4, res.p5].forEach(num => {
          if (!contagem[num]) contagem[num] = 0;
          contagem[num]++;
        });
      });
    });
  });

  const maisFrequentes = Object.entries(contagem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    maisFrequentes
  };
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) return cache;

  const bancas = await pegarBancas();
  const federal = await pegarFederal();

  const dadosHoje = {
    ...bancas,
    federal
  };

  salvarHistorico(dadosHoje);

  const historico = lerHistorico();
  const analise = analisar(historico);

  cache = {
    atualizado: new Date().toLocaleString(),
    historico,
    analise
  };

  tempo = agora;

  return cache;
}

// ================= ROTAS =================
app.get("/resultados", async (req, res) => {
  const dados = await carregarTudo();
  res.json(dados);
});

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});