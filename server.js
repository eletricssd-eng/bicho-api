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

  return lista.map(r=>({
    horario: extrairHorario(r.horario || r.nome),
    p1: r.p1 || r.premio1,
    p2: r.p2 || r.premio2,
    p3: r.p3 || r.premio3,
    p4: r.p4 || r.premio4,
    p5: r.p5 || r.premio5
  })).filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

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
// 🔍 DESCOBERTA DE APIs
//////////////////////////////////////////////////

const APIS = {};

async function descobrirAPIs(){

  try{
    const { data } = await axios.get(BASE_URL);

    const links = data.match(/https?:\/\/[^\s"'<>]+/g) || [];

    for(const l of links){
      if(l.includes("api") || l.includes("resultado")){
        APIS[l] = { score: 1 };
      }
    }

  }catch{}
}

async function escanearScripts(){

  try{
    const { data } = await axios.get(BASE_URL);
    const $ = cheerio.load(data);

    let scripts = [];

    $("script").each((i,e)=>{
      const src = $(e).attr("src");
      if(src){
        scripts.push(src.startsWith("http") ? src : BASE_URL + src);
      }
    });

    for(const s of scripts){
      try{
        const { data } = await axios.get(s);

        const matches = data.match(/\/api\/[a-zA-Z0-9-_\/]+/g);

        if(matches){
          matches.forEach(m=>{
            APIS[BASE_URL + m] = { score: 1 };
          });
        }

      }catch{}
    }

  }catch{}
}

//////////////////////////////////////////////////
// 🔁 BUSCA PRO
//////////////////////////////////////////////////

async function buscarResultados(){

  const urls = Object.keys(APIS);

  // 🔥 tenta APIs
  let respostas = await Promise.all(
    urls.map(url => fetchAPI(url))
  );

  let dados = respostas
    .map(r => normalizarAPI(r))
    .flat();

  if(dados.length > 0){
    return dados;
  }

  // 🔁 fallback scraping
  return await scraper(BASE_URL);
}

//////////////////////////////////////////////////
// 💾 MONGO
//////////////////////////////////////////////////

mongoose.connect(process.env.MONGO_URL)
  .then(()=> console.log("Mongo OK"))
  .catch(()=> console.log("Erro Mongo"));

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  data: String,
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
  res.send("API PRO MAX 🔥");
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
// 🚀 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(descobrirAPIs, 1000 * 60 * 10);
setInterval(escanearScripts, 1000 * 60 * 30);

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 rodando", PORT);
});