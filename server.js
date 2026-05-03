import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 ANTI-BLOQUEIO
//////////////////////////////////////////////////

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
];

const fonteScore = {};

const delay = ms => new Promise(r => setTimeout(r, ms));

function aumentarScore(url){
  fonteScore[url] = (fonteScore[url] || 0) + 1;
}

function diminuirScore(url){
  fonteScore[url] = (fonteScore[url] || 0) - 2;
}

//////////////////////////////////////////////////
// 🔥 FETCH COM RETRY
//////////////////////////////////////////////////

async function fetchComRetry(url, tentativas = 3){
  for(let i = 0; i < tentativas; i++){
    try{
      const res = await axios.get(url, {
        timeout: 15000,
        httpsAgent,
        headers:{
          "User-Agent": USER_AGENTS[Math.floor(Math.random()*USER_AGENTS.length)]
        },
        validateStatus: () => true
      });

      if(res.status >= 200 && res.status < 300){
        aumentarScore(url);
        return res.data;
      }

      diminuirScore(url);
      await delay(1000 * (i+1));

    }catch{
      diminuirScore(url);
      await delay(1000 * (i+1));
    }
  }
  return null;
}

//////////////////////////////////////////////////
// 🔥 MONGO
//////////////////////////////////////////////////

await mongoose.connect(process.env.MONGO_URL);

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type:String, unique:true },
  data:String,
  banca:String,
  horario:String,
  p1:String,p2:String,p3:String,p4:String,p5:String
}));

//////////////////////////////////////////////////
// 🧠 FILTRO
//////////////////////////////////////////////////

function limparNumeros(nums){
  return nums.filter(n=>{
    const num = parseInt(n);
    if(num < 1000 || num > 9999) return false;
    if(["1200","1366","1920","1080"].includes(n)) return false;
    if(/^(\d)\1{3}$/.test(n)) return false;
    return true;
  });
}

function limparHorario(txt){
  if(!txt) return null;
  const m = txt.match(/\d{1,2}:\d{2}|\d{1,2}h/);
  if(!m) return null;
  let h = m[0].replace("h",":00");
  let [hh,mm] = h.split(":");
  return `${hh.padStart(2,"0")}:${mm}`;
}

function resultadoValido(i){
  if(!i) return false;
  const nums = [i.p1,i.p2,i.p3,i.p4,i.p5];
  if(nums.some(n=>!n)) return false;
  if(nums.some(n=>!/^\d{4}$/.test(n))) return false;
  if(nums.every(n=>n===nums[0])) return false;
  return true;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){

  const html = await fetchComRetry(url);
  if(!html) return [];

  const $ = cheerio.load(html);
  let lista = [];

  if(!/resultado|extração|prêmio/i.test($("body").text())){
    return [];
  }

  $("table").each((i,tb)=>{

    let titulo = $(tb).prevAll("h2,h3,strong").first().text().trim();

    let nums = [];

    $(tb).find("tr").each((i,tr)=>{
      const m = $(tr).text().match(/\b\d{4}\b/g);
      if(m) nums.push(...m);
    });

    nums = limparNumeros(nums.map(n=>n.trim()));

    const horario = limparHorario(titulo);

    if(nums.length >= 5 && horario){

      const item = {
        horario,
        p1:nums[0],p2:nums[1],p3:nums[2],p4:nums[3],p5:nums[4]
      };

      if(resultadoValido(item)){
        lista.push(item);
      }
    }
  });

  // 🚫 SEM FALLBACK LIXO

  const mapa = new Map();

  lista.forEach(i=>{
    const key = `${i.horario}-${i.p1}-${i.p2}-${i.p3}`;
    if(!mapa.has(key)) mapa.set(key,i);
  });

  return Array.from(mapa.values());
}

//////////////////////////////////////////////////
// 🔁 TODAS AS FONTES
//////////////////////////////////////////////////

const TODAS_FONTES = [
  "https://bichodata.com",
  "https://ejogodobicho.com",
  "https://playbicho.com/resultado-jogo-do-bicho",
  "https://www.resultadodobichohoje.com.br/rio",
  "https://resultadofacil.net",
  "https://www.resultadofacil.com.br"
];

//////////////////////////////////////////////////
// 🔥 MULTI SCRAPER
//////////////////////////////////////////////////

async function pegarResultados(){

  const ordenadas = [...TODAS_FONTES].sort((a,b)=>
    (fonteScore[b]||0)-(fonteScore[a]||0)
  );

  let resultados = [];

  for(const url of ordenadas){

    if((fonteScore[url]||0) < -5) continue;

    const dados = await scraper(url);

    if(dados.length){
      console.log("✅", url, dados.length);
      resultados.push(...dados);
    }else{
      console.log("❌", url);
      diminuirScore(url);
    }
  }

  // dedup geral
  const mapa = new Map();

  resultados.forEach(i=>{
    const key = `${i.horario}-${i.p1}-${i.p2}`;
    if(!mapa.has(key)) mapa.set(key,i);
  });

  return Array.from(mapa.values());
}

//////////////////////////////////////////////////
// 🚀 PIPELINE
//////////////////////////////////////////////////

async function pegarTudo(){

  const base = await pegarResultados();

  return {
    rio: base,
    look: base,
    nacional: base,
    federal: []
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvarMongo(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){
    for(const item of dados[banca]){

      const uniqueId = `${hoje}-${banca}-${item.horario}`;

      await Resultado.findOneAndUpdate(
        { uniqueId },
        { ...item, data:hoje, banca, uniqueId },
        { upsert:true }
      );
    }
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function historico(){

  const dados = await Resultado.find().lean();
  const h = {};

  dados.forEach(r=>{
    if(!h[r.data]) h[r.data]={rio:[],look:[],nacional:[],federal:[]};
    h[r.data][r.banca].push(r);
  });

  return h;
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache=null, tempo=0;

async function carregar(){

  if(cache && Date.now()-tempo < 60000) return cache;

  console.log("🔄 ATUALIZANDO...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  cache = {
    atualizado: new Date().toLocaleString("pt-BR"),
    historico: await historico()
  };

  tempo = Date.now();

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTAS
//////////////////////////////////////////////////

app.get("/",(req,res)=>res.send("OK"));

app.get("/resultados", async (req,res)=>{
  res.json(await carregar());
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>console.log("🚀 rodando", PORT));