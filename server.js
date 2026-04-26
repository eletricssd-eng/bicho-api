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
// 🔥 MONGO (VERSÃO PROFISSIONAL)
//////////////////////////////////////////////////

const MONGO_URL = process.env.MONGO_URL;

async function conectarMongo(){

  if(!MONGO_URL){
    console.log("❌ MONGO_URL NÃO DEFINIDA");
    return;
  }

  try{
    await mongoose.connect(MONGO_URL, {
      serverSelectionTimeoutMS: 5000
    });

    console.log("✅ Mongo conectado");

  }catch(e){
    console.log("❌ erro mongo:", e.message);

    // 🔥 tenta reconectar sozinho
    setTimeout(conectarMongo, 5000);
  }

}

conectarMongo();

//////////////////////////////////////////////////
// 📦 MODEL
//////////////////////////////////////////////////

const ResultadoSchema = new mongoose.Schema({
  data: String,
  banca: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String
});

const Resultado = mongoose.model("Resultado", ResultadoSchema);

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){
  try{

    const { data } = await axios.get(url, {
      headers:{ "User-Agent":"Mozilla/5.0" },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if(!titulo) titulo = "Horário " + (i+1);

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const m = $(tr).text().match(/\d{4}/);
        if(m) nums.push(m[0]);
      });

      if(nums.length >= 5){
        lista.push({
          horario: titulo,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }

    });

    return lista;

  }catch(e){
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 BANCAS
//////////////////////////////////////////////////

async function pegarTudo(){

  const [rio, look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    pegarFederalUltimo()
  ]);

  return { rio, look, nacional, federal };
}

/////////////////////////////////////////////////////
//  PEGAR FEDERAL
/////////////////////////////////////////////////////

async function pegarFederalUltimo(){

  const { data } = await axios.get(
    "https://www.resultadofacil.com.br/ultimos-resultados-federal",
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );

  const $ = cheerio.load(data);

  let ultimo = null;

  $("table").each((i, tabela)=>{

    const nums = [];

    $(tabela).find("tr").each((i,tr)=>{
      const m = $(tr).text().match(/\d{4}/);
      if(m) nums.push(m[0]);
    });

    if(nums.length >= 5){
      ultimo = {
        horario: "Último sorteio",
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      };
    }

  });

  return ultimo ? [ultimo] : [];
}

//////////////////////////////////////////////////
// 💾 SALVAR NO MONGO
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo não conectado, pulando save");
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const item of dados[banca]){

      try{
        await Resultado.findOneAndUpdate(
          { data: hoje, banca, horario: item.horario },
          { ...item, data: hoje, banca },
          { upsert: true }
        );
      }catch(e){
        console.log("❌ erro salvar:", e.message);
      }

    }

  }

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico(){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo offline, retornando vazio");
    return {};
  }

  const dados = await Resultado.find().lean();

  const historico = {};

  dados.forEach(r=>{

    if(!historico[r.data]){
      historico[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    historico[r.data][r.banca].push(r);

  });

  return historico;
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

  console.log("🔄 atualizando...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  const historico = await pegarHistorico();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTAS
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("✅ API ONLINE");
});

app.get("/resultados", async (req,res)=>{
  const dados = await carregarTudo();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 API rodando na porta", PORT);
});