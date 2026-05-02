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
// 🔥 ANTI-BLOQUEIO PROFISSIONAL
//////////////////////////////////////////////////

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
];

const fonteScore = {};

function delay(ms){
  return new Promise(res => setTimeout(res, ms));
}

function aumentarScore(url){
  fonteScore[url] = (fonteScore[url] || 0) + 1;
}

function diminuirScore(url){
  fonteScore[url] = (fonteScore[url] || 0) - 2;
}

async function fetchComRetry(url, tentativas = 3){

  for(let i = 0; i < tentativas; i++){

    try{

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          "Accept": "text/html,application/xhtml+xml"
        },
        validateStatus: () => true
      });

      if(response.status >= 200 && response.status < 300){
        aumentarScore(url);
        return response.data;
      }

      if(response.status >= 500){
        diminuirScore(url);
        await delay(1000 * (i+1));
        continue;
      }

    }catch(e){
      diminuirScore(url);
      await delay(1000 * (i+1));
    }
  }

  return null;
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
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){

  const data = await fetchComRetry(url);

  if(!data){
    console.log("❌ falha total:", url);
    return [];
  }

  try{
    const $ = cheerio.load(data);
    let lista = [];

    // TABLE
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

    // FALLBACK TEXTO
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

    // DEDUP
    const mapa = new Map();

    lista.forEach(i=>{
      const chave = i.horario;
      if(!mapa.has(chave)){
        mapa.set(chave, i);
      }
    });

    return Array.from(mapa.values());

  }catch(e){
    console.log("❌ erro parse:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔁 FONTES INTELIGENTES
//////////////////////////////////////////////////

async function tentarFontes(fontes){

  const ordenadas = [...fontes].sort((a,b)=>{
    return (fonteScore[b] || 0) - (fonteScore[a] || 0);
  });

  for(const url of ordenadas){

    if((fonteScore[url] || 0) < -5){
      console.log("🚫 pulando fonte ruim:", url);
      continue;
    }

    const dados = await scraper(url);

    if(dados.length >= 1){
      console.log("✅ fonte OK:", url);
      aumentarScore(url);
      return dados;
    }

    console.log("⚠️ falhou:", url);
    diminuirScore(url);
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

  }catch{
    console.log("❌ federal falhou");
    return [];
  }
}

//////////////////////////////////////////////////
// 🚀 PIPELINE
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

  if(mongoose.connection.readyState !== 1) return;

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

  if(cache && (agora - tempo < 60000)){
    return cache;
  }

  console.log("🔄 ATUALIZANDO...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  const historico = await pegarHistorico();

  cache = {
    atualizado: new Date().toLocaleString("pt-BR"),
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