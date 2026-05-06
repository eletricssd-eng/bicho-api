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
    const res = await axios.get(url, { timeout: 15000 });
    return res.data;
  }catch{
    return null;
  }
}

//////////////////////////////////////////////////
// 🧠 FUNÇÕES AUXILIARES
//////////////////////////////////////////////////

function extrairHorario(texto){
  if(!texto) return null;

  const match = texto.match(/\d{1,2}:\d{2}|\d{1,2}h/);
  if(!match) return null;

  let h = match[0].replace("h", ":00");

  const [hora, min] = h.split(":");

  return `${hora.padStart(2,"0")}:${min}`;
}

function resultadoValido(r){
  if(!r) return false;

  const nums = [r.p1,r.p2,r.p3,r.p4,r.p5];

  return nums.every(n => /^\d{4}$/.test(n));
}

//////////////////////////////////////////////////
// 🧠 NORMALIZAÇÃO API
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
      horario: extrairHorario(r.horario || r.nome || r.titulo || "") || "00:00",
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    };

  }).filter(Boolean).filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔍 SCRAPER INTELIGENTE
//////////////////////////////////////////////////

async function scraper(url){

  const html = await fetchHTML(url);
  if(!html) return [];

  const $ = cheerio.load(html);
  let resultados = [];

  $("h2, h3, strong").each((i, el)=>{

    const titulo = $(el).text();

    const horario = extrairHorario(titulo);
    if(!horario) return;

    const tabela = $(el).nextAll("table").first();

    if(!tabela) return;

    let nums = [];

    tabela.find("tr").each((i,tr)=>{
      const m = $(tr).text().match(/\b\d{4}\b/g);
      if(m) nums.push(...m);
    });

    if(nums.length >= 5){

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

  return resultados.filter(resultadoValido);
}

//////////////////////////////////////////////////
// 🔁 BUSCA POR BANCA
//////////////////////////////////////////////////

async function buscarBanca(banca){

  console.log("🔎 Buscando:", banca);

  // 🔥 tenta API
  const apiData = await fetchAPI(APIS[banca]);
  let dados = normalizarAPI(apiData);

  console.log("API retornou:", dados.length);

  // 🔁 fallback se falhar
  if(dados.length < 2){

    console.log("⚠️ fallback scraping:", banca);

    if(FONTES[banca]){
      const raspado = await scraper(FONTES[banca]);

      if(raspado.length > 0){
        console.log("✔ scraping OK:", raspado.length);
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
  res.send("🔥 API PRO COMPLETA ONLINE");
});

app.get("/resultados", async (req,res)=>{
  try{
    const dados = await carregar();
    res.json(dados);
  }catch(e){
    res.status(500).json({ erro: e.message });
  }
});

app.get("/resultados/:banca", async (req,res)=>{

  const banca = req.params.banca.toLowerCase();

  try{
    const dados = await carregar();

    if(!dados.historico[banca]){
      return res.status(404).json({ erro: "Banca inválida" });
    }

    res.json({
      atualizado: dados.atualizado,
      resultados: dados.historico[banca]
    });

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