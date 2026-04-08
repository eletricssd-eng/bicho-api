import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const YT_KEY = "AIzaSyAGQ1mYfOxWm97S90nR0Hew-ukg3VdU4vE";

// canais confiáveis (adicione mais se quiser)
const canais = [
  "UC0cRrQj7hX9r0x0d9wq0R8A"
];

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= UTIL =================
function limparNumeros(nums) {
  return nums.filter(n => /^\d{4}$/.test(n));
}

// ================= SCRAPER RESULTADO FACIL =================
async function pegarNacional() {
  try {
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $ = cheerio.load(data);
    const nums = [];

    $("table tr").each((i, el) => {
      const texto = $(el).text();

      if (texto.includes("1º") || texto.includes("2º") || texto.includes("3º")) {
        const match = texto.match(/\d{4}/);
        if (match) nums.push(match[0]);
      }
    });

    if (nums.length < 5) return [];

    return [{
      horario: "Nacional",
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    }];

  } catch (e) {
    console.log("Erro Nacional:", e.message);
    return [];
  }
}

// ================= LOOK =================
async function pegarLook() {
  try {
    const { data } = await axios.get("https://lookgoias.com/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const nums = [];

    $("table tr").each((i, el) => {
      const texto = $(el).text();
      const match = texto.match(/\d{4}/);
      if (match) nums.push(match[0]);
    });

    if (nums.length < 5) return [];

    return [{
      horario: "Look",
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    }];

  } catch {
    return [];
  }
}

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

// ================= YOUTUBE =================
async function buscarPorCanal(channelId) {
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          part: "snippet",
          channelId,
          order: "date",
          maxResults: 10,
          key: YT_KEY
        }
      }
    );

    return res.data.items;

  } catch {
    return [];
  }
}

function extrairResultados(texto) {
  const linhas = texto.split("\n");
  const nums = [];

  for (let linha of linhas) {
    if (linha.includes("1") || linha.includes("2") || linha.includes("3")) {
      const match = linha.match(/\d{4}/);
      if (match) nums.push(match[0]);
    }
  }

  if (nums.length < 5) return null;

  return {
    horario: "Rio",
    p1: nums[0],
    p2: nums[1],
    p3: nums[2],
    p4: nums[3],
    p5: nums[4]
  };
}

async function pegarRio() {
  for (let canal of canais) {
    const videos = await buscarPorCanal(canal);

    for (let v of videos) {
      const texto = v.snippet.title + " " + v.snippet.description;

      const resultado = extrairResultados(texto);

      if (resultado) return [resultado];
    }
  }

  return [];
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) return cache;

  console.log("🔄 Atualizando...");

  const [look, rio, nacional, federal] = await Promise.all([
    pegarLook(),
    pegarRio(),
    pegarNacional(),
    pegarFederal()
  ]);

  cache = {
    atualizado: new Date().toLocaleString(),
    rio,
    look,
    nacional,
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
    api: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});