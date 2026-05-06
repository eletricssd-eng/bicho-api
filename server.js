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

const BASE_URL = "https://www.resultadofacil.com.br";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)",
  "Mozilla/5.0 (iPhone)"
];

const delay = ms => new Promise(r => setTimeout(r, ms));

//////////////////////////////////////////////////
// 🔥 APIS FIXAS (GARANTIA)
//////////////////////////////////////////////////

const APIS = {};

const APIS_FIXAS = [
  "https://www.resultadofacil.com.br/api/resultado/pt-rio",
  "https://www.resultadofacil.com.br/api/resultado/look",
  "https://www.resultadofacil.com.br/api/resultado/nacional",
  "https://www.resultadofacil.com.br/api/resultado/federal"
];

APIS_FIXAS.forEach(url=>{
  APIS[url] = { score: 10 };
});

//////////////////////////////////////////////////
// 📊 SCORE
//////////////////////////////////////////////////

const fonteScore = {};
const fonteFail = {};

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
// 🌐 FETCH
//////////////////////////////////////////////////

async function fetchHTML(url){

  if(bloqueada(url)) return null;

  try{
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length | 0]
      }
    });

    scoreUp(url);
    return res.data;

  }catch{
    scoreDown(url);
    return null;
  }
}

async function fetchAPI(url){

  try{
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length | 0],
        "Accept": "application/json"
      }
    });

    scoreUp(url);
    return res.data;

  }catch{
    scoreDown(url);
    return null;
  }
}

//////////////////////////////////////////////////
// 🧹 FILTRO
//////////////////////////////////////////////////

function limparNumeros(nums){
  return nums.filter(n => /^\d{4}$/.test(n));
}

function extrairHorario(texto){
  const m = texto?.match(/\d{1,2}:\d{2}/);
  return m ? m[0] : "00:00";
}

function resultadoValido(r){
  if(!r) return false;
  const nums = [r.p1,r.p2,r.p3,r.p4,r.p5];
  return nums.every(n => /^\d{4}$/.test(n));
}

//////////////////////////////////////////////////
// 🧠 NORMALIZADOR
//////////////////////////////////////////////////

function normalizarAPI(data){

  if(!data) return [];

  let lista = [];

  if(Array.isArray(data)) lista = data;
  else if(data.listaResultado) lista = data.listaResultado;
  else if(data.resultados) lista = data.resultados;

  return lista.map(r=>{

    const nums = [
      r.p1 || r.premio1,
      r.p2 || r.premio2,
      r.p3 || r.premio3,
      r.p4 || r.premio4,
      r.p5 || r.premio5
    ];

    if(nums.some(n => !n)) return null;

    return {
      horario: extrairHorario(r.horario || r.nome || ""),
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    };

  }).filter(Boolean);
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (REAL)
//////////////////////////////////////////////////

const FONTES = [
  "https://www.resultadofacil.com.br/resultados-pt-rio",
  "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje",
  "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje-de-hoje"
];

async function scraper(url){

  const html = await fetchHTML(url);
  if(!html) return [];

  const $ = cheerio.load(html);
  let resultados = [];

  $("table").each((i,t)=>{

    let nums = [];

    $(t).find("tr").each((i,tr)=>{
      const m = $(tr).text().match(/\d{4}/g);
      if(m) nums.push(...m);
    });

    nums = limparNumeros(nums);

    if(nums.length >= 5){
      resultados.push({
        horario: "00:00",
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      });
    }
  });

  return resultados.filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔍 AUTO DISCOVERY
//////////////////////////////////////////////////

async function descobrirAPIs(){

  try{
    const { data } = await axios.get(BASE_URL);

    const links = data.match(/https?:\/\/[^\s"'<>]+/g) || [];

    for(const l of links){
      if(l.includes("api") || l.includes("resultado")){
        APIS[l] = { score: 1 };
      }
    }

    console.log("🔍 APIs encontradas:", Object.keys(APIS).length);

  }catch{}
}

//////////////////////////////////////////////////
// 🔁 BUSCA
//////////////////////////////////////////////////

async function buscarResultados(){

  console.log("🚀 Buscando...");

  const urls = Object.keys(APIS);

  console.log("APIS:", urls);

  let respostas = await Promise.all(
    urls.map(url => fetchAPI(url))
  );

  console.log("RESPOSTAS:", respostas.length);

  let dados = respostas
    .map(r => normalizarAPI(r))
    .flat()
    .filter(resultadoValido);

  if(dados.length > 0){
    console.log("✅ Dados via API:", dados.length);
    return dados;
  }

  console.log("⚠️ fallback scraping...");

  const raspados = await Promise.all(
    FONTES.map(url => scraper(url))
  );

  return raspados.flat();
}

//////////////////////////////////////////////////
// 💾 MONGO
//////////////////////////////////////////////////

mongoose.connect(process.env.MONGO_URL)
  .then(()=> console.log("✅ Mongo OK"))
  .catch(()=> console.log("❌ erro Mongo"));

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  data: String,
  horario: String,
  p1:String,p2:String,p3:String,p4:String,p5:String
}));

async function salvar(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const r of dados){
    await Resultado.create({ ...r, data: hoje });
  }
}

//////////////////////////////////////////////////
// ⚡ CACHE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregar(){

  if(cache && Date.now() - tempo < 60000){
    return cache;
  }

  const dados = await buscarResultados();

  await salvar(dados);

  cache = {
    atualizado: new Date().toLocaleString("pt-BR"),
    dados
  };

  tempo = Date.now();

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("🔥 API PRO FUNCIONANDO");
});

app.get("/resultados", async (req,res)=>{
  try{
    const r = await carregar();
    res.json(r);
  }catch(e){
    res.status(500).json({ erro: e.message });
  }
});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(descobrirAPIs, 1000 * 60 * 10);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 rodando na porta", PORT);
});