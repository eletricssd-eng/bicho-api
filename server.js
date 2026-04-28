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
// 🔥 MONGO (AUTO RECONNECT)
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
    setTimeout(conectarMongo, 5000);
  }

}

conectarMongo();

//////////////////////////////////////////////////
// 📦 MODEL (COM UNIQUEID)
//////////////////////////////////////////////////

const ResultadoSchema = new mongoose.Schema({
  uniqueId: { type: String, unique: true },

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
// 🔍 SCRAPER MELHORADO
//////////////////////////////////////////////////

async function scraper(url){
  try{

    const { data } = await axios.get(url, {
      headers:{ "User-Agent":"Mozilla/5.0" },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if(!titulo) titulo = "Horário " + (i+1);

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/g);
        if(match){
          match.forEach(n => nums.push(n));
        }
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

    // 🔥 fallback
    if(lista.length === 0){

      const texto = $("body").text();
      const numeros = texto.match(/\d{4}/g);

      if(numeros && numeros.length >= 5){
        lista.push({
          horario: "Extração",
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4]
        });
      }

    }

    return lista;

  }catch(e){
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🇧🇷 FEDERAL (ÚLTIMO)
//////////////////////////////////////////////////

async function pegarFederal(){

  const lista = await scraper(
    "https://www.resultadofacil.com.br/resultado-banca-federal"
  );

  return lista.length ? [lista[0]] : [];
}

//////////////////////////////////////////////////
// 🏦 TODAS BANCAS
//////////////////////////////////////////////////

async function pegarTudo(){

  const [rio, look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    pegarFederal()
  ]);

  return { rio, look, nacional, federal };
}

//////////////////////////////////////////////////
// 💾 SALVAR (SEM DUPLICAR)
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo offline - não salvou");
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const item of dados[banca]){

      try{

        const uniqueId = `${hoje}-${banca}-${item.horario}`;

        await Resultado.findOneAndUpdate(
          { uniqueId },
          { ...item, data: hoje, banca, uniqueId },
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
    console.log("⚠️ Mongo offline");
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
// 🌐 ROTAS (ANTI-CRASH)
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("✅ API ONLINE");
});

app.get("/resultados", async (req,res)=>{
  try{
    const dados = await carregarTudo();
    res.json(dados);
  }catch(e){
    console.log("❌ ERRO GERAL:", e.message);
    res.status(500).json({
      erro: "Erro interno",
      detalhe: e.message
    });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 API rodando na porta", PORT);
});