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
// 🌐 FETCH
//////////////////////////////////////////////////

async function fetchAPI(url){
  try{
    const res = await axios.get(url, { timeout: 10000 });
    return res.data;
  }catch{
    return null;
  }
}

async function fetchHTML(url){
  try{
    const res = await axios.get(url);
    return res.data;
  }catch{
    return null;
  }
}

//////////////////////////////////////////////////
// 🧠 NORMALIZAÇÃO
//////////////////////////////////////////////////

function extrairHorario(texto){
  const m = texto?.match(/\d{1,2}:\d{2}/);
  return m ? m[0] : "00:00";
}

function resultadoValido(r){
  const nums = [r.p1,r.p2,r.p3,r.p4,r.p5];
  return nums.every(n => /^\d{4}$/.test(n));
}

function normalizarAPI(data){

  if(!data) return [];

  let lista = [];

  if(Array.isArray(data)) lista = data;
  else if(data.listaResultado) lista = data.listaResultado;
  else if(data.resultados) lista = data.resultados;

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
// 🔁 BUSCA POR BANCA
//////////////////////////////////////////////////

async function buscarBanca(banca){

  // 🔥 tenta API
  const apiData = await fetchAPI(APIS[banca]);

  let dados = normalizarAPI(apiData);

  if(dados.length > 0){
    return dados;
  }

  // 🔁 fallback scraping
  if(FONTES[banca]){
    return await scraper(FONTES[banca]);
  }

  return [];
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
  .then(()=> console.log("Mongo OK"))
  .catch(()=> console.log("Erro Mongo"));

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

      const uniqueId = `${hoje}-${banca}-${r.horario}-${r.p1}-${r.p2}`;

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
  res.send("🔥 API POR BANCA ONLINE");
});

// geral
app.get("/resultados", async (req,res)=>{
  const dados = await carregar();
  res.json(dados);
});

// por banca
app.get("/resultados/:banca", async (req,res)=>{

  const banca = req.params.banca.toLowerCase();

  const dados = await carregar();

  if(!dados.historico[banca]){
    return res.status(404).json({ erro: "Banca inválida" });
  }

  res.json({
    atualizado: dados.atualizado,
    resultados: dados.historico[banca]
  });
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 rodando na porta", PORT);
});