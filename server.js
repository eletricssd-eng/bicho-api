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

// ================= DATA BR =================
function getDataBR(){
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Sao_Paulo"
  });
}

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
    const resultados = [];

    $("h2, h3").each((i, el) => {
      const tituloOriginal = $(el).text().trim();
      const titulo = tituloOriginal.toLowerCase();

      // ✅ pegar apenas Federal 1 ao 5
      if (!titulo.includes("federal")) return;
      if (!titulo.includes("1º ao 5º")) return;

      // 🔥 EXTRAIR DATA
      const matchData = tituloOriginal.match(/\d{2}\/\d{2}\/\d{4}/);
      const dataSorteio = matchData ? matchData[0] : "sem data";

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
          // ✅ agora separa por data
          horario: `Federal - ${dataSorteio}`,
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
    console.log("Erro Federal:", e.message);
    return [];
  }
}

// ================= HISTÓRICO =================
function salvarHistorico(dadosHoje) {
  let historico = {};

  if (fs.existsSync(HISTORICO_FILE)) {
    historico = JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }

  const hoje = getDataBR();

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

  const porBanca = {};
  const porHorario = {};
  const vistos = new Set();

  const TODAS = ["rio","look","nacional","federal"];

  Object.values(historico).forEach(dia => {

    TODAS.forEach(banca => {

      (dia[banca] || []).forEach(res => {

        const chave =
          banca +
          res.horario +
          res.p1 +
          res.p2 +
          res.p3 +
          res.p4 +
          res.p5;

        if (vistos.has(chave)) return;
        vistos.add(chave);

        const h = res.horario;

        if (!porBanca[banca]) porBanca[banca] = {};
        if (!porBanca[banca][h]) {
          porBanca[banca][h] = { dezenas:{}, grupos:{} };
        }

        if (!porHorario[h]) {
          porHorario[h] = { dezenas:{}, grupos:{} };
        }

        [res.p1,res.p2,res.p3,res.p4,res.p5].forEach(num => {

          const dez = num.slice(-2);

          porBanca[banca][h].dezenas[dez] =
            (porBanca[banca][h].dezenas[dez] || 0) + 1;

          porHorario[h].dezenas[dez] =
            (porHorario[h].dezenas[dez] || 0) + 1;

          const grupo = getGrupo(num);

          if (grupo) {
            porBanca[banca][h].grupos[grupo] =
              (porBanca[banca][h].grupos[grupo] || 0) + 1;

            porHorario[h].grupos[grupo] =
              (porHorario[h].grupos[grupo] || 0) + 1;
          }

        });

      });

    });

  });

  function top(obj){
    return Object.entries(obj)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,5);
  }

  const resultado = { porBanca:{}, porHorario:{} };

  Object.keys(porBanca).forEach(b=>{
    resultado.porBanca[b] = {};

    Object.keys(porBanca[b]).forEach(h=>{
      resultado.porBanca[b][h] = {
        topDezenas: top(porBanca[b][h].dezenas),
        topGrupos: top(porBanca[b][h].grupos)
      };
    });
  });

  Object.keys(porHorario).forEach(h=>{
    resultado.porHorario[h] = {
      topDezenas: top(porHorario[h].dezenas),
      topGrupos: top(porHorario[h].grupos)
    };
  });

  return resultado;
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

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  const dados = await carregarTudo();
  res.json(dados);
});

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});