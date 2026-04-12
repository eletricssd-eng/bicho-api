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

      if (!titulo.includes("federal")) return;
      if (!titulo.includes("1º ao 5º")) return;

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

  } catch {
    return [];
  }
}

// ================= HISTÓRICO =================
function salvarHistorico(dadosHoje){

  let historico = {};

  if (fs.existsSync(HISTORICO_FILE)) {
    historico = JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }

  // 🧠 pega data do próprio resultado (mais confiável)
  let dataBase = new Date().toISOString().split("T")[0];

  try {
    const exemplo = dadosHoje.rio?.[0]?.horario 
                 || dadosHoje.look?.[0]?.horario
                 || dadosHoje.nacional?.[0]?.horario
                 || dadosHoje.federal?.[0]?.horario;

    const match = exemplo?.match(/\d{2}\/\d{2}\/\d{4}/);

    if(match){
      const [dia, mes, ano] = match[0].split("/");
      dataBase = `${ano}-${mes}-${dia}`;
    }

  } catch {}

  // salva corretamente por data
  historico[dataBase] = dadosHoje;

  // mantém só últimos 7 dias reais
  const datas = Object.keys(historico)
    .sort((a,b)=> new Date(b) - new Date(a))
    .slice(0,7);

  const novo = {};
  datas.forEach(d => novo[d] = historico[d]);

  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(novo, null, 2));
}
// ================= ANÁLISE (IA) =================
function analisar(historico) {

  const porBanca = {};
  const porHorario = {};
  const vistos = new Set();

  const TODAS = ["rio","look","nacional","federal"];
  const datas = Object.keys(historico).sort().reverse();

  datas.forEach((data, index) => {

    let peso = 1;
    if (index === 0) peso = 3;
    else if (index === 1) peso = 2;

    const dia = historico[data];

    TODAS.forEach(banca => {

      (dia[banca] || []).forEach(res => {

        const chave = banca + res.horario + res.p1+res.p2+res.p3+res.p4+res.p5;
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
            (porBanca[banca][h].dezenas[dez] || 0) + peso;

          porHorario[h].dezenas[dez] =
            (porHorario[h].dezenas[dez] || 0) + peso;

          const grupo = getGrupo(num);

          if (grupo) {
            porBanca[banca][h].grupos[grupo] =
              (porBanca[banca][h].grupos[grupo] || 0) + peso;

            porHorario[h].grupos[grupo] =
              (porHorario[h].grupos[grupo] || 0) + peso;
          }

        });

      });

    });

  });

  return { porBanca, porHorario };
}

// ================= PALPITES (IA FORTE) =================
function gerarPalpites(analise) {

  const palpites = {};

  Object.keys(analise.porBanca).forEach(banca => {

    palpites[banca] = {};

    Object.entries(analise.porBanca[banca]).forEach(([horario, dados]) => {

      // ===== ORDENAR POR FORÇA =====
      const dezenas = Object.entries(dados.dezenas)
        .sort((a,b)=>b[1]-a[1])
        .map(d=>d[0]);

      const grupos = Object.entries(dados.grupos)
        .sort((a,b)=>b[1]-a[1])
        .map(g=>g[0]);

      // ===== ATRASADOS DO MESMO HORÁRIO =====
      const atrasados = [];
      for(let i=0;i<100;i++){
        const d = String(i).padStart(2,"0");
        if(!dezenas.includes(d)){
          atrasados.push(d);
        }
      }

      // ===== PALPITE FINAL =====
      palpites[banca][horario] = {
        proximo: true, // 🔥 identifica que é previsão
        dezena: dezenas.slice(0,1),
        duqueDezena: dezenas.slice(0,2),
        ternoDezena: dezenas.slice(0,3),

        grupo: grupos.slice(0,1),
        duqueGrupo: grupos.slice(0,2),
        ternoGrupo: grupos.slice(0,3),

        atrasadas: atrasados.slice(0,5),

        // 🔥 EXTRA INTELIGENTE
        mistura: [
          dezenas[0],
          atrasados[0],
          dezenas[1]
        ]
      };

    });

  });

  return palpites;
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
  const palpites = gerarPalpites(analise);

  cache = {
    atualizado: new Date().toLocaleString(),
    historico,
    analise,
    palpites
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