import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔌 MONGO
//////////////////////////////////////////////////

const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
  console.log("❌ MONGO_URL NÃO DEFINIDA");
} else {
  mongoose.connect(MONGO_URL)
    .then(() => console.log("✅ Mongo conectado"))
    .catch(err => console.log("❌ erro mongo:", err));
}

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
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if(!titulo) titulo = "Horário " + (i+1);

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/);
        if(match) nums.push(match[0]);
      });

      const tituloLower = titulo.toLowerCase();

      const isFederal = tituloLower.includes("federal");
      const is10 = tituloLower.includes("1 ao 10");

      if(isFederal && is10) return;

      if(nums.length >= 5){
        lista.push({
          horario: titulo.replace(/1 ao.*?/gi, "").trim(),
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

  return {
    rio: await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    look: await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    nacional: await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    federal: await scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  };

}

//////////////////////////////////////////////////
// 💾 SALVAR NO MONGO (SEM DUPLICAR)
//////////////////////////////////////////////////

async function salvarMongo(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const item of dados[banca]){

      const existe = await Resultado.findOne({
        data: hoje,
        banca,
        horario: item.horario
      });

      if(!existe){
        await Resultado.create({
          data: hoje,
          banca,
          ...item
        });
      }

    }
  }

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico(){

  const registros = await Resultado.find().sort({ data: -1 });

  const historico = {};

  registros.forEach(r => {

    if(!historico[r.data]){
      historico[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    historico[r.data][r.banca].push({
      horario: r.horario,
      p1: r.p1,
      p2: r.p2,
      p3: r.p3,
      p4: r.p4,
      p5: r.p5
    });

  });

  return historico;

}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregar(){

  const agora = Date.now();

  if(cache && agora - tempo < 60000){
    return cache;
  }

  console.log("🔄 Atualizando...");

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

app.get("/resultados", async (req,res)=>{
  const dados = await carregar();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 API PROFISSIONAL rodando na porta", PORT);
});