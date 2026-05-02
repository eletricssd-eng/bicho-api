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
// 🧠 VALIDAÇÃO
//////////////////////////////////////////////////

function resultadoValido(item){
  if(!item) return false;

  const nums = [item.p1, item.p2, item.p3, item.p4, item.p5];

  if(nums.some(n => !n)) return false;
  if(nums.some(n => !/^\d{4}$/.test(n))) return false;
  if(nums.every(n => n === nums[0])) return false;

  const anoCount = nums.filter(n => n.startsWith("20")).length;
  if(anoCount >= 3) return false;

  return true;
}

//////////////////////////////////////////////////
// 🧠 HORÁRIO
//////////////////////////////////////////////////

function limparHorario(texto){
  if(!texto) return "extra";

  const match = texto.match(/\d{1,2}:\d{2}|\d{1,2}h/);
  if(!match) return "extra";

  let h = match[0].replace("h", ":00");
  const [hora, min] = h.split(":");

  return `${hora.padStart(2,"0")}:${min}`;
}

//////////////////////////////////////////////////
// 🔧 MONTAR ITEM
//////////////////////////////////////////////////

function montarItem(nums, contexto){
  if(!nums || nums.length < 5) return null;

  const horario = limparHorario(contexto);

  const item = {
    horario,
    p1: nums[0],
    p2: nums[1],
    p3: nums[2],
    p4: nums[3],
    p5: nums[4]
  };

  return resultadoValido(item) ? item : null;
}

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
    let lista = [];

    //////////////////////////////////////////
    // TABLE
    //////////////////////////////////////////
    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();

      const numeros = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/g);
        if(match) numeros.push(...match);
      });

      for(let i=0;i<numeros.length;i+=5){
        const bloco = numeros.slice(i,i+5);

        if(bloco.length === 5){
          const item = montarItem(bloco, titulo);
          if(item) lista.push(item);
        }
      }
    });

    //////////////////////////////////////////
    // DIV
    //////////////////////////////////////////
    if(lista.length < 2){

      $("div").each((i, div)=>{

        const texto = $(div).text();
        const numeros = texto.match(/\d{4}/g);

        if(numeros && numeros.length >= 5){

          for(let i=0;i<numeros.length;i+=5){
            const bloco = numeros.slice(i,i+5);

            const item = montarItem(bloco, texto);
            if(item) lista.push(item);
          }
        }
      });
    }

    //////////////////////////////////////////
    // TEXTO PURO
    //////////////////////////////////////////
    if(lista.length < 2){

      const numeros = $("body").text().match(/\d{4}/g);

      if(numeros){

        for(let i=0;i<numeros.length;i+=5){
          const bloco = numeros.slice(i,i+5);

          if(bloco.length === 5){
            const item = montarItem(bloco, "extra");
            if(item) lista.push(item);
          }
        }
      }
    }

    //////////////////////////////////////////
    // DEDUP FORTE
    //////////////////////////////////////////
    const mapa = new Map();

    lista.forEach(i=>{
      const chave = `${i.horario}-${i.p1}-${i.p2}`;
      if(!mapa.has(chave)){
        mapa.set(chave, i);
      }
    });

    return Array.from(mapa.values());

  }catch(e){
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔁 FALLBACK
//////////////////////////////////////////////////

async function tentarFontes(fontes){
  for(const url of fontes){
    const dados = await scraper(url);

    if(dados.length >= 1){
      console.log("✅ fonte OK:", url);
      return dados;
    }

    console.log("⚠️ falhou:", url);
  }
  return [];
}

//////////////////////////////////////////////////
// 🌐 FONTES
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
// 🏦 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      { timeout: 10000 }
    );

    if(!data?.listaResultado?.length) return [];

    const r = data.listaResultado[0];

    const item = {
      horario: "federal",
      p1: r.premio1,
      p2: r.premio2,
      p3: r.premio3,
      p4: r.premio4,
      p5: r.premio5
    };

    return resultadoValido(item) ? [item] : [];

  }catch(e){
    return [];
  }
}

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 API rodando na porta", PORT);
});