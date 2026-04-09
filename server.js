import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const HISTORICO_FILE = "./historico.json";

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
  if (!dezena) return null;
  const final = dezena.slice(-2);
  for (let [nome, lista] of grupos) {
    if (lista.includes(final)) return nome;
  }
  return null;
}

// ================= EXTRAIR HORÁRIO =================
function extrairHorario(texto) {
  try {
    if (!texto) return "outros";

    const t = texto.toLowerCase();

    if (t.includes("ptm")) return "PTM";
    if (t.includes("ptv")) return "PTV";
    if (t.includes("pt")) return "PT";

    const hora = texto.match(/\d{2}:\d{2}|\d{2}h/);
    if (hora) return hora[0];

    return "outros";
  } catch {
    return "outros";
  }
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

  } catch (e) {
    console.log("Erro scraper:", url);
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

  } catch (e) {
    console.log("Erro Federal:", e.message);
  }

  return [];
}

// ================= HISTÓRICO =================
function salvarHistorico(dadosHoje) {
  let historico = {};

  try {
    if (fs.existsSync(HISTORICO_FILE)) {
      historico = JSON.parse(fs.readFileSync(HISTORICO_FILE, "utf-8"));
    }
  } catch {
    historico = {};
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
  try {
    if (!fs.existsSync(HISTORICO_FILE)) return {};
    return JSON.parse(fs.readFileSync(HISTORICO_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// ================= ANÁLISE =================
function analisar(historico) {
  try {
    const porBanca = {};
    const porHorario = {};
    const gruposBanca = {};
    const gruposHorario = {};

    Object.values(historico || {}).forEach(dia => {
      ["rio", "look", "nacional"].forEach(banca => {

        (dia[banca] || []).forEach(res => {

          const horario = extrairHorario(res.horario);

          if (!porBanca[banca]) porBanca[banca] = {};
          if (!porBanca[banca][horario]) porBanca[banca][horario] = {};

          if (!porHorario[horario]) porHorario[horario] = {};

          if (!gruposBanca[banca]) gruposBanca[banca] = {};
          if (!gruposBanca[banca][horario]) gruposBanca[banca][horario] = {};

          if (!gruposHorario[horario]) gruposHorario[horario] = {};

          [res.p1, res.p2, res.p3, res.p4, res.p5].forEach(num => {

            if (!num) return;

            const final = num.slice(-2);

            porBanca[banca][horario][final] =
              (porBanca[banca][horario][final] || 0) + 1;

            porHorario[horario][final] =
              (porHorario[horario][final] || 0) + 1;

            const grupo = getGrupo(num);

            if (grupo) {
              gruposBanca[banca][horario][grupo] =
                (gruposBanca[banca][horario][grupo] || 0) + 1;

              gruposHorario[horario][grupo] =
                (gruposHorario[horario][grupo] || 0) + 1;
            }

          });

        });

      });
    });

    function top(obj) {
      return Object.entries(obj || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    }

    const resumoBanca = {};
    Object.keys(porBanca).forEach(banca => {
      resumoBanca[banca] = {};
      Object.keys(porBanca[banca]).forEach(h => {
        resumoBanca[banca][h] = {
          topDezenas: top(porBanca[banca][h]),
          topGrupos: top(gruposBanca[banca][h])
        };
      });
    });

    const resumoHorario = {};
    Object.keys(porHorario).forEach(h => {
      resumoHorario[h] = {
        topDezenas: top(porHorario[h]),
        topGrupos: top(gruposHorario[h])
      };
    });

    return {
      porBanca: resumoBanca,
      porHorario: resumoHorario
    };

  } catch (e) {
    console.log("Erro análise:", e.message);
    return { porBanca: {}, porHorario: {} };
  }
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) return cache;

  console.log("🔄 atualizando...");

  const bancas = await pegarBancas();
  const federal = await pegarFederal();

  const dadosHoje = { ...bancas, federal };

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