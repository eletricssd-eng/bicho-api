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
// 🔧 CONFIG
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
// 🧠 SCORE
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
// 🚀 FETCH
//////////////////////////////////////////////////

async function fetchHTML(url, tentativas = 3){

  if(bloqueada(url)) return null;

  for(let i = 0; i < tentativas; i++){
    try{
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length | 0],
          "Accept": "text/html",
          "Accept-Language": "pt-BR,pt;q=0.9",
          "Cache-Control": "no-cache"
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
// 🧹 FILTRO
//////////////////////////////////////////////////

function limparNumeros(nums){
  return nums.filter(n=>{
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
// 🕐 HORARIO
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
// ✅ VALIDAÇÃO
//////////////////////////////////////////////////

function resultadoValido(r){
  if(!r) return false;

  const nums = [r.p1,r.p2,r.p3,r.p4,r.p5];

  if(nums.some(n => !/^\d{4}$/.test(n))) return false;

  if(new Set(nums).size < 3) return false;

  return true;
}

//////////////////////////////////////////////////
// 🧠 CONSENSO
//////////////////////////////////////////////////

function consensoResultados(lista){

  const mapa = {};

  lista.forEach(r=>{
    const chave = `${r.horario}-${r.p1}-${r.p2}-${r.p3}`;

    if(!mapa[chave]) mapa[chave] = [];
    mapa[chave].push(r);
  });

  return Object.values(mapa)
    .filter(grupo => grupo.length >= 2)
    .map(grupo => grupo[0]);
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

    const bodyText = $("body").text();
    if(!/resultado|extração|prêmio/i.test(bodyText)){
      return [];
    }

    $("table").each((i, tabela)=>{

      const texto = $(tabela).text();

      if(!/1º|2º|3º|4º|5º/i.test(texto)) return;

      let nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\b\d{4}\b/g);
        if(match) nums.push(...match);
      });

      nums = limparNumeros(nums);

      if(nums.length >= 5){

        resultados.push({
          horario: extrairHorario(texto) || "00:00",
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }
    });

    if(resultados.length > 0) scoreUp(url);
    else scoreDown(url);

    return resultados.filter(resultadoValido);

  }catch{
    scoreDown(url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTES
//////////////////////////////////////////////////

const FONTES = {
  rio: [
    "https://www.resultadofacil.com.br/resultados-pt-rio",
    "https://www.federalbicho.com/",
    "https://www.resultadojogodobicho.com.br/"
  ],
  look: [
    "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"
  ],
  nacional: [
    "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje-de-hoje"
  ]
};

//////////////////////////////////////////////////
// 🔁 BUSCA POR BANCA
//////////////////////////////////////////////////

async function buscarPorBanca(fontes){

  const ordenadas = [...fontes].sort((a,b)=>{
    return (fonteScore[b] || 0) - (fonteScore[a] || 0);
  });

  const respostas = await Promise.all(
    ordenadas.map(url => scraper(url))
  );

  let todos = respostas.flat();

  todos = todos.filter(resultadoValido);

  const confiaveis = consensoResultados(todos);

  return confiaveis.sort((a,b)=> a.horario.localeCompare(b.horario));
}

//////////////////////////////////////////////////
// 🏦 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const html = await fetchHTML("https://www.resultadofacil.com.br/resultado-banca-federal");

    if(typeof html === "string"){
      const $ = cheerio.load(html);
      let nums = [];

      $("table tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/g);
        if(match) nums.push(...match);
      });

      nums = limparNumeros(nums);

      if(nums.length >= 5){
        return [{
          horario: "federal",
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        }];
      }
    }

    return [];
  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🚀 PIPELINE
//////////////////////////////////////////////////

async function pegarTudo(){

  const resultado = {};

  for(const banca in FONTES){
    resultado[banca] = await buscarPorBanca(FONTES[banca]);
  }

  resultado.federal = await pegarFederal();

  return resultado;
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
// ⚡ CACHE
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
  res.send("✅ API PRO ONLINE");
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