import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🇧🇷 TIMEZONE BRASIL
//////////////////////////////////////////////////

function agoraBR(){
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function hojeBR(){
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Sao_Paulo"
  });
}

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

  uniqueId: {
    type: String,
    unique: true
  },

  data: String,
  banca: String,
  horario: String,

  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String

});

//////////////////////////////////////////////////
// 🚀 INDEX PERFORMANCE
//////////////////////////////////////////////////

ResultadoSchema.index({ data: -1 });
ResultadoSchema.index({ banca: 1 });

const Resultado = mongoose.model(
  "Resultado",
  ResultadoSchema
);

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){

  try{

    const { data } = await axios.get(url, {

      headers:{
        "User-Agent":"Mozilla/5.0"
      },

      timeout:10000

    });

    const $ = cheerio.load(data);

    const lista = [];

    const tabelas = $("table");

    tabelas.each((i,tabela)=>{

      let titulo = "";

      const prev =
        $(tabela)
        .prevAll("h2,h3,strong")
        .first();

      if(prev.length){
        titulo = prev.text().trim();
      }

      if(!titulo || titulo.length < 5){
        titulo = "Horário " + (i+1);
      }

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{

        const texto = $(tr).text();

        const match = texto.match(/\d{4}/);

        if(match){
          nums.push(match[0]);
        }

      });

      //////////////////////////////////////////////////
      // 🔥 FILTRO FEDERAL
      //////////////////////////////////////////////////

      const tituloLower =
        titulo.toLowerCase();

      const isFederal =
        tituloLower.includes("federal");

      const is10 =
        tituloLower.includes("1 ao 10")
        || tituloLower.includes("10º");

      if(isFederal && is10){
        return;
      }

      //////////////////////////////////////////////////
      // ✅ SOMENTE RESULTADOS COMPLETOS
      //////////////////////////////////////////////////

      if(nums.length >= 5){

        lista.push({

          horario:
            titulo
              .replace(/1 ao 10º?/gi,"")
              .replace(/1 ao 5º?/gi,"")
              .replace(/resultado do dia/gi,"")
              .trim(),

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

async function pegarBancas(){

  const [
    rio,
    look,
    nacional
  ] = await Promise.all([

    scraper(
      "https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"
    ),

    scraper(
      "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"
    ),

    scraper(
      "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"
    )

  ]);

  return {
    rio,
    look,
    nacional
  };
}

//////////////////////////////////////////////////
// 🇧🇷 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){

  let lista = await scraper(
    "https://www.resultadofacil.com.br/resultado-banca-federal"
  );

  lista = lista.map(item => ({

    horario:
      item.horario
        .replace(/1 ao 10º?/gi,"")
        .replace(/1 ao 5º?/gi,"")
        .replace(/resultado do dia/gi,"")
        .trim(),

    p1:item.p1,
    p2:item.p2,
    p3:item.p3,
    p4:item.p4,
    p5:item.p5

  }));

  //////////////////////////////////////////////////
  // 🔥 SOMENTE 1 FEDERAL
  //////////////////////////////////////////////////

  lista = lista.slice(0,1);

  return lista;
}

//////////////////////////////////////////////////
// 💾 SALVAR MONGO
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){

    console.log("⚠️ Mongo offline");

    return;
  }

  const hoje = hojeBR();

  for(const banca in dados){

    for(const item of dados[banca]){

      try{

        const uniqueId =
          `${hoje}-${banca}-${item.horario}`;

        await Resultado.findOneAndUpdate(

          { uniqueId },

          {
            ...item,
            data: hoje,
            banca,
            uniqueId
          },

          {
            upsert:true
          }

        );

      }catch(e){

        console.log(
          "❌ erro salvar:",
          e.message
        );

      }

    }

  }

}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache = null;

let tempo = 0;

//////////////////////////////////////////////////
// 🚀 MAIN
//////////////////////////////////////////////////

async function carregarTudo(){

  const agora = Date.now();

  //////////////////////////////////////////////////
  // 🔥 CACHE 60s
  //////////////////////////////////////////////////

  if(cache && (agora - tempo < 60000)){
    return cache;
  }

  console.log("🔄 Atualizando dados...");

  //////////////////////////////////////////////////
  // 🔍 SCRAPING
  //////////////////////////////////////////////////

  const bancas = await pegarBancas();

  const federal = await pegarFederal();

  const dadosHoje = {
    ...bancas,
    federal
  };

  //////////////////////////////////////////////////
  // 💾 SALVA MONGO
  //////////////////////////////////////////////////

  await salvarMongo(dadosHoje);

  //////////////////////////////////////////////////
  // 🔥 ÚLTIMOS 7 DIAS DIRETO DO MONGO
  //////////////////////////////////////////////////

  const seteDias = new Date();

  seteDias.setDate(
    seteDias.getDate() - 7
  );

  const limite =
    seteDias
      .toISOString()
      .split("T")[0];

  const resultados =
    await Resultado.find({

      data:{
        $gte: limite
      }

    })
    .sort({
      data:-1
    });

  //////////////////////////////////////////////////
  // 🔥 MONTA HISTÓRICO
  //////////////////////////////////////////////////

  const historico = {};

  resultados.forEach(r => {

    if(!historico[r.data]){

      historico[r.data] = {
        rio:[],
        look:[],
        nacional:[],
        federal:[]
      };

    }

    if(!historico[r.data][r.banca]){
      historico[r.data][r.banca] = [];
    }

    //////////////////////////////////////////////////
    // 🔥 EVITA DUPLICADOS
    //////////////////////////////////////////////////

    const existe =
      historico[r.data][r.banca]
      .find(i => i.horario === r.horario);

    if(existe) return;

    historico[r.data][r.banca].push({

      horario:r.horario,

      p1:r.p1,
      p2:r.p2,
      p3:r.p3,
      p4:r.p4,
      p5:r.p5

    });

  });

  //////////////////////////////////////////////////
  // 🔥 ORDENA DATAS
  //////////////////////////////////////////////////

  const ordenado = {};

  Object.keys(historico)

    .sort((a,b)=>
      new Date(b) - new Date(a)
    )

    .forEach(d => {
      ordenado[d] = historico[d];
    });

  //////////////////////////////////////////////////
  // 🚀 CACHE FINAL
  //////////////////////////////////////////////////

  cache = {

    atualizado: agoraBR(),

    historico: ordenado

  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/resultados", async(req,res)=>{

  try{

    const dados = await carregarTudo();

    res.json(dados);

  }catch(e){

    console.log(e);

    res.status(500).json({
      erro:true
    });

  }

});

//////////////////////////////////////////////////
// 🌐 ÚLTIMOS RESULTADOS
//////////////////////////////////////////////////

app.get("/ultimos", async(req,res)=>{

  try{

    const dados =
      await Resultado.find()

      .sort({
        data:-1
      })

      .limit(30);

    res.json(dados);

  }catch(e){

    res.status(500).json({
      erro:true
    });

  }

});

//////////////////////////////////////////////////
// 🌐 POR BANCA
//////////////////////////////////////////////////

app.get("/banca/:nome", async(req,res)=>{

  try{

    const dados =
      await Resultado.find({

        banca:req.params.nome

      })

      .sort({
        data:-1
      });

    res.json(dados);

  }catch(e){

    res.status(500).json({
      erro:true
    });

  }

});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{

  console.log(
    "🚀 Server rodando na porta",
    PORT
  );

});