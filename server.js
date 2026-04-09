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

// ================= GRUPOS =================
const grupos = [
  ["Avestruz", ["01","02","03","04"]],
  ["Águia", ["05","06","07","08"]],
  ["Burro", ["09","10","11","12"]],
  ["Borboleta", ["13","14","15","16"]],
  ["Cachorro", ["17","18","19","20"]],
  ["Cabra", ["21","22","23","24"]],
  ["Carneiro", ["25","26","27","28"]],
  ["Camelo", ["29","30","31","32"]],
  ["Cobra", ["33","34","35","36"]],
  ["Coelho", ["37","38","39","40"]],
  ["Cavalo", ["41","42","43","44"]],
  ["Elefante", ["45","46","47","48"]],
  ["Galo", ["49","50","51","52"]],
  ["Gato", ["53","54","55","56"]],
  ["Jacaré", ["57","58","59","60"]],
  ["Leão", ["61","62","63","64"]],
  ["Macaco", ["65","66","67","68"]],
  ["Porco", ["69","70","71","72"]],
  ["Pavão", ["73","74","75","76"]],
  ["Peru", ["77","78","79","80"]],
  ["Touro", ["81","82","83","84"]],
  ["Tigre", ["85","86","87","88"]],
  ["Urso", ["89","90","91","92"]],
  ["Veado", ["93","94","95","96"]],
  ["Vaca", ["97","98","99","00"]],
];

function getGrupo(dezena) {
  const final = dezena.slice(-2);
  for (let [nome, lista] of grupos) {
    if (lista.includes(final)) return nome;
  }
  return null;
}

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
    rio: await scraperBanca("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    look: await scraperBanca("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    nacional: await scraperBanca("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje")
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

    if (resultado) return [resultado];

  } catch {}

  return [];
}

// ================= HISTÓRICO =================
function salvarHistorico(dadosHoje) {
  let historico = {};

  if (fs.existsSync(HISTORICO_FILE)) {
    historico = JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }

  const hoje = new Date().toISOString().split("T")[0];
  historico[hoje] = dadosHoje;

  const datas = Object.keys(historico)
    .sort()
    .reverse()
    .slice(0, 7);

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
  const finais = {};
  const gruposCont = {};
  const atrasados = {};

  const ultimosResultados = [];

  Object.values(historico).forEach(dia => {
    ["rio", "look", "nacional"].forEach(banca => {

      (dia[banca] || []).forEach(res => {

        [res.p1, res.p2, res.p3, res.p4, res.p5].forEach(num => {

          const final = num.slice(-2);

          // ===== FINAIS =====
          finais[final] = (finais[final] || 0) + 1;

          // ===== GRUPOS =====
          const grupo = getGrupo(num);
          if (grupo) {
            gruposCont[grupo] = (gruposCont[grupo] || 0) + 1;
          }

          ultimosResultados.push(final);
        });

      });

    });
  });

  // ================= ATRASADOS =================
  for (let i = 0; i < 100; i++) {
    const dez = String(i).padStart(2, "0");

    if (!ultimosResultados.includes(dez)) {
      atrasados[dez] = true;
    }
  }

  // ================= TOP =================
  const topFinais = Object.entries(finais)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const topGrupos = Object.entries(gruposCont)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const listaAtrasados = Object.keys(atrasados).slice(0, 10);

  return {
    topFinais,
    topGrupos,
    atrasados: listaAtrasados
  };
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) return cache;

  console.log("🔄 atualizando...");

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