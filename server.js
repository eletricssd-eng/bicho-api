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
// 🔥 MONGO
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
// 📦 MODEL
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
// 🔍 SCRAPER BASE (FORTE)
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
        if(match) match.forEach(n => nums.push(n));
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

    // fallback bruto
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
// 🔁 TENTAR VÁRIAS FONTES
//////////////////////////////////////////////////

async function tentarFontes(fontes){
  for(const url of fontes){
    const dados = await scraper(url);
    if(dados.length){
      console.log("✅ fonte OK:", url);
      return dados;
    }
    console.log("⚠️ falhou:", url);
  }
  return [];
}

//////////////////////////////////////////////////
// 🌐 FONTES POR BANCA
//////////////////////////////////////////////////

const FONTES = {

  rio: [
    "https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje",
    "https://resultadofacil.net/resultados-do-rio-de-hoje",
    "https://www.resultadodobichohoje.com.br/rio"
  ],

  look: [
    "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje",
    "https://resultadofacil.net/look-loterias-de-hoje"
  ],

  nacional: [
    "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje",
    "https://resultadofacil.net/loteria-nacional-de-hoje"
  ]

};

//////////////////////////////////////////////////
// 🏦 FEDERAL (API OFICIAL)
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      { timeout: 10000 }
    );

    if(!data || !data.listaResultado) return [];

    const r = data.listaResultado[0];

    return [{
      horario: "Federal",
      p1: r.premio1,
      p2: r.premio2,
      p3: r.premio3,
      p4: r.premio4,
      p5: r.premio5
    }];

  }catch(e){
    console.log("❌ erro federal API, fallback site");

    return await tentarFontes([
      "https://www.resultadofacil.com.br/resultado-banca-federal"
    ]);
  }
}

//////////////////////////////////////////////////
// 🏦 PEGAR TODAS
//////////////////////////////////////////////////

async function pegarTudo(){

  const [rio, look, nacional, federal] = await Promise.all([
    tentarFontes(FONTES.rio),
    tentarFontes(FONTES.look),
    tentarFontes(FONTES.nacional),
    pegarFederal()
  ]);

  return { rio, look, nacional, federal };
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo offline");
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

  if(mongoose.connection.readyState !== 1) return {};

  const dados = await Resultado.find().lean();
  const historico = {};

  dados.forEach(r=>{
    if(!historico[r.data]){
      historico[r.data] = {
        rio: [], look: [], nacional: [], federal: []
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
  try{
    const dados = await carregarTudo();
    res.json(dados);
  }catch(e){
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