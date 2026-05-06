import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
];

const fonteScore = {};
const fonteFail = {};

const delay = ms => new Promise(r => setTimeout(r, ms));

//////////////////////////////////////////////////
// 🧠 SCORE INTELIGENTE
//////////////////////////////////////////////////

function scoreUp(url){
  fonteScore[url] = (fonteScore[url] || 0) + 2;
  fonteFail[url] = 0;
}

function scoreDown(url){
  fonteScore[url] = (fonteScore[url] || 0) - 2;
  fonteFail[url] = (fonteFail[url] || 0) + 1;
}

function bloqueada(url){
  return (fonteFail[url] || 0) >= 5;
}

//////////////////////////////////////////////////
// 🚀 FETCH COM RETRY
//////////////////////////////////////////////////

async function fetchHTML(url, tentativas = 3){

  if(bloqueada(url)) return null;

  for(let i = 0; i < tentativas; i++){

    try{
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length | 0],
          "Accept": "text/html"
        },
        validateStatus: () => true
      });

      if(res.status >= 200 && res.status < 300){
        scoreUp(url);
        return res.data;
      }

      scoreDown(url);
      await delay(1000 * (i+1));

    }catch{
      scoreDown(url);
      await delay(1000 * (i+1));
    }
  }

  return null;
}

//////////////////////////////////////////////////
// 🧠 FILTRO ANTI-LIXO
//////////////////////////////////////////////////

function limparNumeros(nums){

  return nums.filter(n => {

    if(!/^\d{4}$/.test(n)) return false;

    const num = parseInt(n);

    if(num < 1000 || num > 9999) return false;

    if([
      "0000","1111","2222","3333","4444",
      "5555","6666","7777","8888","9999",
      "1234","1000","2024","2025","2026"
    ].includes(n)) return false;

    return true;
  });
}

//////////////////////////////////////////////////
// 🧠 HORÁRIO
//////////////////////////////////////////////////

function extrairHorario(texto){

  if(!texto) return null;

  const match = texto.match(/\d{1,2}:\d{2}|\d{1,2}h/);

  if(!match) return null;

  let h = match[0].replace("h", ":00");

  const [hora, min] = h.split(":");

  return `${hora.padStart(2,"0")}:${min}`;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){

  const html = await fetchHTML(url);

  if(!html || typeof html !== "string") return [];

  try{

    const $ = cheerio.load(html);
    let resultados = [];

    // 🚨 proteção contra página lixo
    const texto = $("body").text();
    if(!/resultado|extração|prêmio/i.test(texto)){
      return [];
    }

    $("table").each((i, tabela)=>{

      const titulo = $(tabela).prevAll("h2,h3,strong").first().text();

      let nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\b\d{4}\b/g);
        if(match) nums.push(...match);
      });

      nums = limparNumeros(nums);

      if(nums.length >= 5){

        const horario = extrairHorario(titulo);
        if(!horario) return;

        resultados.push({
          horario,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }
    });

    return resultados;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🔁 MULTI-FONTE
//////////////////////////////////////////////////

async function buscarResultados(fontes){

  const ordenadas = [...fontes].sort((a,b)=>{
    return (fonteScore[b] || 0) - (fonteScore[a] || 0);
  });

  const promessas = ordenadas.map(url => scraper(url));
  const respostas = await Promise.all(promessas);

  let todos = respostas.flat();

  // só válidos
  todos = todos.filter(r => r && r.horario);

  // dedup forte
  const mapa = new Map();

  todos.forEach(r=>{
    const chave = `${r.horario}-${r.p1}-${r.p2}-${r.p3}`;
    if(!mapa.has(chave)){
      mapa.set(chave, r);
    }
  });

  let finais = Array.from(mapa.values());

  // ordena
  finais.sort((a,b)=> a.horario.localeCompare(b.horario));

  // limite
  return finais.slice(0, 10);
}

//////////////////////////////////////////////////
// 🌐 FONTES
//////////////////////////////////////////////////

const FONTES = [
  "https://www.resultadofacil.com.br/resultados-pt-rio" ,
  "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje-de-hoje",
  "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"
  
];

//////////////////////////////////////////////////
// 🏦 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/resultado-banca-federal"
    );

    const r = data.listaResultado?.[0];
    if(!r) return [];

    return [{
      horario: "federal",
      p1: r.premio1,
      p2: r.premio2,
      p3: r.premio3,
      p4: r.premio4,
      p5: r.premio5
    }];

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🚀 PIPELINE
//////////////////////////////////////////////////

async function pegarTudo(){

  const [resultados, federal] = await Promise.all([
    buscarResultados(FONTES),
    pegarFederal()
  ]);

  return {
    rio: resultados,
    look: resultados,
    nacional: resultados,
    federal
  };
}

//////////////////////////////////////////////////
// 💾 MONGO
//////////////////////////////////////////////////

const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
  .then(()=> console.log("✅ Mongo conectado"))
  .catch(()=> console.log("❌ erro Mongo"));

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true },
  data: String,
  banca: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String
}));

async function salvarMongo(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){
    for(const item of dados[banca]){

      const uniqueId = `${hoje}-${banca}-${item.horario}`;

      await Resultado.findOneAndUpdate(
        { uniqueId },
        { ...item, banca, data: hoje, uniqueId },
        { upsert: true }
      );
    }
  }
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo(){

  const agora = Date.now();

  if(cache && (agora - tempo < 60000)){
    return cache;
  }

  console.log("🔄 ATUALIZANDO...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  cache = {
    atualizado: new Date().toLocaleString("pt-BR"),
    historico: dados
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("✅ API ONLINE");
});

app.get("/resultados", async (req,res)=>{
  try{
    const dados = await carregarTudo();
    res.json(dados);
  }catch(e){
    res.status(500).json({ erro: e.message });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 rodando na porta", PORT);
});