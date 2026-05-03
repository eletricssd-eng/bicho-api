import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import puppeteer from "puppeteer";

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

//////////////////////////////////////////////////
// 🧠 UTIL
//////////////////////////////////////////////////

const delay = ms => new Promise(r => setTimeout(r, ms));

//////////////////////////////////////////////////
// 🚀 FETCH RENDERIZADO (PUPPETEER)
//////////////////////////////////////////////////

async function fetchRenderizado(url){

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    USER_AGENTS[Math.random()*USER_AGENTS.length | 0]
  );

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 30000
  });

  await delay(3000);

  const html = await page.content();

  await browser.close();

  return html;
}

//////////////////////////////////////////////////
// 🧠 FILTRO FORTE
//////////////////////////////////////////////////

function limparNumeros(nums){

  return nums.filter(n => {

    if(!/^\d{4}$/.test(n)) return false;

    const num = parseInt(n);

    if(num < 1000 || num > 9999) return false;

    // lixo comum
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

  try{

    const html = await fetchRenderizado(url);

    if(!html) return [];

    const $ = cheerio.load(html);
    let resultados = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text();

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

    console.log("📊", url, resultados.length);

    return resultados;

  }catch(e){
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔁 MULTI-FONTE
//////////////////////////////////////////////////

async function buscarResultados(fontes){

  const promessas = fontes.map(url => scraper(url));
  const resultados = await Promise.all(promessas);

  let todos = resultados.flat();

  // só válidos
  todos = todos.filter(r => r && r.horario);

  // dedup
  const mapa = new Map();

  todos.forEach(r=>{
    const chave = `${r.horario}-${r.p1}-${r.p2}`;
    if(!mapa.has(chave)){
      mapa.set(chave, r);
    }
  });

  return Array.from(mapa.values()).slice(0, 15);
}

//////////////////////////////////////////////////
// 🌐 FONTES
//////////////////////////////////////////////////

const FONTES = [
  "https://bichodata.com",
  "https://ejogodobicho.com",
  "https://playbicho.com/resultado-jogo-do-bicho",
  "https://www.resultadodobichohoje.com.br/rio"
];

//////////////////////////////////////////////////
// 🏦 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal"
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