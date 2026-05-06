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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "text/html,application/json",
  "Accept-Language": "pt-BR,pt;q=0.9",
  "Referer": "https://www.resultadofacil.com.br/",
  "Origin": "https://www.resultadofacil.com.br",
  "Connection": "keep-alive"
};

const APIS = {
  rio: "https://www.resultadofacil.com.br/api/resultado/pt-rio",
  look: "https://www.resultadofacil.com.br/api/resultado/look",
  nacional: "https://www.resultadofacil.com.br/api/resultado/nacional",
  federal: "https://www.resultadofacil.com.br/api/resultado/federal"
};

const FONTES = {
  rio: "https://www.resultadofacil.com.br/resultados-pt-rio",
  look: "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje",
  nacional: "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje-de-hoje"
};

//////////////////////////////////////////////////
// 🔁 RETRY
//////////////////////////////////////////////////

async function fetchComRetry(url, tipo = "html", tentativas = 3){

  for(let i = 0; i < tentativas; i++){
    try{

      const res = await axios.get(url, {
        timeout: 15000,
        headers: HEADERS
      });

      return res.data;

    }catch(e){
      console.log(`❌ erro (${i+1}) em ${url}`);
      await new Promise(r => setTimeout(r, 1000 * (i+1)));
    }
  }

  return null;
}

//////////////////////////////////////////////////
// 🌐 FETCH
//////////////////////////////////////////////////

async function fetchAPI(url){
  return await fetchComRetry(url, "json");
}

async function fetchHTML(url){
  return await fetchComRetry(url, "html");
}

//////////////////////////////////////////////////
// 🧠 AUX
//////////////////////////////////////////////////

function extrairHorario(texto){
  const m = texto?.match(/\d{1,2}:\d{2}|\d{1,2}h/);
  if(!m) return null;

  let h = m[0].replace("h", ":00");
  const [hora, min] = h.split(":");

  return `${hora.padStart(2,"0")}:${min}`;
}

function resultadoValido(r){
  return [r.p1,r.p2,r.p3,r.p4,r.p5].every(n => /^\d{4}$/.test(n));
}

//////////////////////////////////////////////////
// 🧠 NORMALIZAÇÃO
//////////////////////////////////////////////////

function normalizarAPI(data){

  if(!data) return [];

  let lista = [];

  if(Array.isArray(data)) lista = data;
  else if(data.listaResultado) lista = data.listaResultado;
  else if(data.resultados) lista = data.resultados;
  else if(data.data) lista = data.data;

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
      horario: extrairHorario(r.horario || r.nome || "") || "00:00",
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    };

  }).filter(Boolean).filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔍 SCRAPER ROBUSTO
//////////////////////////////////////////////////

async function scraper(url){

  const html = await fetchHTML(url);

  if(!html){
    console.log("❌ HTML vazio:", url);
    return [];
  }

  // DEBUG REAL
  console.log("📄 HTML recebido (inicio):", html.slice(0,200));

  const $ = cheerio.load(html);

  let resultados = [];

  $("table").each((i, tabela)=>{

    let nums = [];

    $(tabela).find("tr").each((i,tr)=>{
      const match = $(tr).text().match(/\b\d{4}\b/g);
      if(match) nums.push(...match);
    });

    if(nums.length >= 5){

      resultados.push({
        horario: `extra-${i}`,
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      });
    }
  });

  console.log("📊 SCRAPER achou:", resultados.length);

  return resultados.filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔁 BUSCA
//////////////////////////////////////////////////

async function buscarBanca(banca){

  console.log("🔎 Buscando:", banca);

  const apiData = await fetchAPI(APIS[banca]);
  let dados = normalizarAPI(apiData);

  console.log("API:", dados.length);

  if(dados.length < 2){

    console.log("⚠️ usando scraper:", banca);

    if(FONTES[banca]){
      const raspado = await scraper(FONTES[banca]);

      if(raspado.length > 0){
        return raspado;
      }
    }
  }

  return dados;
}

//////////////////////////////////////////////////
// 🚀 PIPELINE
//////////////////////////////////////////////////

async function pegarTudo(){

  const resultado = {};

  for(const banca of ["rio","look","nacional","federal"]){
    resultado[banca] = await buscarBanca(banca);
  }

  return resultado;
}

//////////////////////////////////////////////////
// 💾 MONGO
//////////////////////////////////////////////////

mongoose.connect(process.env.MONGO_URL)
  .then(()=> console.log("✅ Mongo conectado"))
  .catch(()=> console.log("❌ erro Mongo"));

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true },
  banca: String,
  data: String,
  horario: String,
  p1:String,p2:String,p3:String,p4:String,p5:String
}));

async function salvar(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const r of dados[banca]){

      const uniqueId = `${hoje}-${banca}-${r.horario}-${r.p1}-${r.p2}-${r.p3}`;

      await Resultado.findOneAndUpdate(
        { uniqueId },
        { ...r, banca, data: hoje, uniqueId },
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

async function carregar(){

  if(cache && Date.now() - tempo < 60000){
    return cache;
  }

  console.log("🔄 ATUALIZANDO...");

  const dados = await pegarTudo();

  await salvar(dados);

  cache = {
    atualizado: new Date().toLocaleString("pt-BR"),
    historico: dados
  };

  tempo = Date.now();

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("🔥 API ANTI-BLOQUEIO ONLINE");
});

app.get("/resultados", async (req,res)=>{
  const dados = await carregar();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 rodando na porta", PORT);
});