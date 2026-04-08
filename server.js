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

// ================= DATAS =================
function gerarDatas(qtd = 7) {
  const datas = [];

  for (let i = 0; i < qtd; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);

    const dia = String(d.getDate()).padStart(2, "0");
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const ano = d.getFullYear();

    datas.push(`${ano}-${mes}-${dia}`);
  }

  return datas;
}

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
    console.log("Erro:", url);
    return [];
  }
}

// ================= BANCAS =================
async function pegarBancas() {
  const datas = gerarDatas(7);

  const resultado = {
    rio: {},
    look: {},
    nacional: {}
  };

  for (let data of datas) {

    // URLs com data
    const urls = {
      rio: `https://www.resultadofacil.com.br/resultado-do-jogo-do-bicho-rio/${data}`,
      look: `https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje`,
      nacional: `https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje`
    };

    // RIO (com data)
    resultado.rio[data] = await scraperBanca(urls.rio);

    // LOOK (site não usa data na URL, então repete)
    resultado.look[data] = await scraperBanca(urls.look);

    // NACIONAL (mesma coisa)
    resultado.nacional[data] = await scraperBanca(urls.nacional);
  }

  return resultado;
}

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const sorteio = data.listaSorteios?.[0];

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

  } catch {
    return [];
  }
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) return cache;

  console.log("🔄 Atualizando...");

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

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});