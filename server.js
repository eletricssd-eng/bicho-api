import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import puppeteer from "puppeteer";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////

const httpsAgent = new https.Agent({ rejectUnauthorized:false });

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)"
];

const FONTES = [
  "https://ejogodobicho.com/resultados-rio-pt",
  "https://ejogodobicho.com/resultados-look-goias",
  "https://ejogodobicho.com/resultados-loteria-nacional-ln",
  "https://www.resultadodobichohoje.com.br/rio"
];

//////////////////////////////////////////////////
// 🔥 MONGO
//////////////////////////////////////////////////

await mongoose.connect(process.env.MONGO_URL);

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId:{ type:String, unique:true },
  data:String,
  banca:String,
  horario:String,
  p1:String,p2:String,p3:String,p4:String,p5:String
}));

//////////////////////////////////////////////////
// 🧠 UTIL
//////////////////////////////////////////////////

const delay = ms => new Promise(r=>setTimeout(r,ms));

function limparNumeros(nums){
  return nums.filter(n=>{
    const num = parseInt(n);
    if(num < 1000 || num > 9999) return false;
    if(["1200","1366","1920","1080"].includes(n)) return false;
    if(/^(\d)\1{3}$/.test(n)) return false;
    return true;
  });
}

function validarBloco(b){
  if(b.length !== 5) return false;
  const uniq = new Set(b).size;
  return uniq >= 3;
}

//////////////////////////////////////////////////
// ⚡ AXIOS SCRAPER
//////////////////////////////////////////////////

async function scraperAxios(url){

  try{
    const res = await axios.get(url,{
      timeout:10000,
      httpsAgent,
      headers:{
        "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length|0]
      }
    });

    const $ = cheerio.load(res.data);

    let nums = $("body").text().match(/\b\d{4}\b/g) || [];
    nums = limparNumeros(nums);

    let lista = [];

    for(let i=0;i<nums.length;i+=5){
      const bloco = nums.slice(i,i+5);
      if(validarBloco(bloco)){
        lista.push({
          horario:"auto",
          p1:bloco[0],p2:bloco[1],p3:bloco[2],p4:bloco[3],p5:bloco[4]
        });
      }
    }

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🔥 PUPPETEER SCRAPER
//////////////////////////////////////////////////

async function scraperPuppeteer(url){

  const browser = await puppeteer.launch({
    headless:true,
    args:["--no-sandbox"]
  });

  try{

    const page = await browser.newPage();

    await page.setUserAgent(USER_AGENTS[0]);

    await page.goto(url,{ waitUntil:"networkidle2", timeout:20000 });

    const content = await page.content();

    const $ = cheerio.load(content);

    let nums = $("body").text().match(/\b\d{4}\b/g) || [];
    nums = limparNumeros(nums);

    let lista = [];

    for(let i=0;i<nums.length;i+=5){
      const bloco = nums.slice(i,i+5);
      if(validarBloco(bloco)){
        lista.push({
          horario:"auto",
          p1:bloco[0],p2:bloco[1],p3:bloco[2],p4:bloco[3],p5:bloco[4]
        });
      }
    }

    return lista;

  }catch{
    return [];
  }finally{
    await browser.close();
  }
}

//////////////////////////////////////////////////
// 🚀 SCRAPER DEFINITIVO
//////////////////////////////////////////////////

async function pegarResultados(){

  let resultados = [];

  for(const url of FONTES){

    console.log("🔎 tentando:", url);

    let dados = await scraperAxios(url);

    if(dados.length){
      console.log("⚡ axios OK:", dados.length);
      resultados.push(...dados);
      continue;
    }

    console.log("🐢 fallback puppeteer...");

    dados = await scraperPuppeteer(url);

    if(dados.length){
      console.log("🔥 puppeteer OK:", dados.length);
      resultados.push(...dados);
    }else{
      console.log("❌ falhou total");
    }

    await delay(1000);
  }

  // dedup
  const mapa = new Map();

  resultados.forEach(i=>{
    const key = `${i.p1}-${i.p2}-${i.p3}`;
    if(!mapa.has(key)) mapa.set(key,i);
  });

  return Array.from(mapa.values());
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvar(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const item of dados){

    const uniqueId = `${hoje}-${item.p1}-${item.p2}`;

    await Resultado.findOneAndUpdate(
      { uniqueId },
      { ...item, data:hoje, banca:"geral", uniqueId },
      { upsert:true }
    );
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function historico(){

  const dados = await Resultado.find().lean();

  const h = {};

  dados.forEach(r=>{
    if(!h[r.data]) h[r.data]={geral:[]};
    h[r.data].geral.push(r);
  });

  return h;
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache=null, tempo=0;

async function carregar(){

  if(cache && Date.now()-tempo < 60000) return cache;

  console.log("🔄 ATUALIZANDO DEFINITIVO...");

  const dados = await pegarResultados();

  await salvar(dados);

  cache = {
    atualizado:new Date().toLocaleString("pt-BR"),
    historico: await historico()
  };

  tempo = Date.now();

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTAS
//////////////////////////////////////////////////

app.get("/",(req,res)=>res.send("SCRAPER DEFINITIVO ON"));

app.get("/resultados", async (req,res)=>{
  res.json(await carregar());
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT,()=>console.log("🔥 DEFINITIVO rodando", PORT));