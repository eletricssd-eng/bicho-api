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
// 🧠 NORMALIZA HORÁRIO (🔥 MELHORADO)
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
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){
  try{
    const { data } = await axios.get(url, {
      headers:{ "User-Agent":"Mozilla/5.0" },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    let lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if(!titulo) titulo = "extra";

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/g);
        if(match) nums.push(...match);
      });

      if(nums.length >= 5){

        const item = {
          horario: limparHorario(titulo),
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        };

        if(resultadoValido(item)){
          lista.push(item);
        }
      }
    });

    // fallback
    if(lista.length === 0){

      const numeros = $("body").text().match(/\d{4}/g);

      if(numeros && numeros.length >= 10){

        const item = {
          horario: "extra",
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4]
        };

        if(resultadoValido(item)){
          lista.push(item);
        }
      }
    }

    // 🔥 REMOVE DUPLICADOS MELHOR
    const mapa = new Map();

    lista.forEach(i=>{
      const chave = i.horario;

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
// 🏦 FEDERAL (🔥 CORRIGIDO)
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
    console.log("❌ federal falhou");
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 PEGAR TUDO
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
// 💾 SALVAR (🔥 MELHORADO)
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo offline");
    return;
  }

  const hoje = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Sao_Paulo"
});

if(cache && (agora - tempo < 60000)){
  // se ainda não tem muitos resultados hoje, força atualização
  const hojeDados = cache?.historico?.[hoje];

  if(hojeDados){
    const total = 
      hojeDados.rio.length +
      hojeDados.look.length +
      hojeDados.nacional.length;

    if(total >= 5){
      return cache;
    }
  }
}

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
// 📊 HISTÓRICO (🔥 ORDENADO)
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

  // ordena por horário
  for(const data in historico){
    for(const banca in historico[data]){
      historico[data][banca].sort((a,b)=> a.horario.localeCompare(b.horario));
    }
  }

  return historico;
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo(){

  const agora = Date.now();

  if(cache && (agora - tempo < 20000)){
    return cache;
  }

  console.log("🔄 atualizando...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  const historico = await pegarHistorico();

  cache = {
    atualizado: new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    }),
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