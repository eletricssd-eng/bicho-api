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

await mongoose.connect(process.env.MONGO_URL);
console.log("✅ Mongo conectado");

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true },
  data: String,
  banca: String,
  horario: String,
  p1: String, p2: String, p3: String, p4: String, p5: String
}));

//////////////////////////////////////////////////
// 🧠 VALIDAÇÃO
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const nums = [r.p1,r.p2,r.p3,r.p4,r.p5];

  if (nums.some(n => !/^\d{4}$/.test(n))) return false;
  if (nums.some(n => /^(\d)\1{3}$/.test(n))) return false;
  if (nums.some(n => n.startsWith("20"))) return false;
  if (!r.horario || r.horario.toLowerCase().includes("extra")) return false;

  return true;
}

//////////////////////////////////////////////////
// 🔁 FETCH
//////////////////////////////////////////////////

async function fetchHTML(url){
  const { data } = await axios.get(url,{
    headers:{ "User-Agent":"Mozilla/5.0" },
    timeout:15000
  });
  return data;
}

//////////////////////////////////////////////////
// 🔍 FONTES
//////////////////////////////////////////////////

async function fonteResultadoFacil(){
  try{
    const html = await fetchHTML("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje");
    const $ = cheerio.load(html);

    const lista = [];

    $("table").each((i,t)=>{
      const nums = $(t).text().match(/\b\d{4}\b/g);
      if(nums && nums.length>=5){
        lista.push({
          horario:"RF "+i,
          p1:nums[0],p2:nums[1],p3:nums[2],p4:nums[3],p5:nums[4]
        });
      }
    });

    return lista;

  }catch{ return []; }
}

async function fonteDeuNoPoste(){
  try{
    const html = await fetchHTML("https://www.deunoposte.com/resultado-do-jogo-do-bicho-rj");
    const $ = cheerio.load(html);

    const lista = [];

    $("body").find("table,div").each((i,el)=>{
      const nums = $(el).text().match(/\b\d{4}\b/g);
      if(nums && nums.length>=5){
        lista.push({
          horario:"DNP "+i,
          p1:nums[0],p2:nums[1],p3:nums[2],p4:nums[3],p5:nums[4]
        });
      }
    });

    return lista;

  }catch{ return []; }
}

//////////////////////////////////////////////////
// 🧠 SCORE INTELIGENTE
//////////////////////////////////////////////////

function calcularScore(lista){

  if(!lista.length) return 0;

  let score = 0;

  lista.forEach(r=>{
    if(resultadoValido(r)) score += 5;

    // diversidade de números
    const set = new Set([r.p1,r.p2,r.p3,r.p4,r.p5]);
    if(set.size >= 4) score += 2;

    // horário real
    if(!r.horario.includes("Alt")) score += 1;
  });

  return score;
}

//////////////////////////////////////////////////
// 🏆 ESCOLHER MELHOR FONTE
//////////////////////////////////////////////////

async function escolherMelhorFonte(){

  const fontes = [
    { nome:"RF", fn:fonteResultadoFacil },
    { nome:"DNP", fn:fonteDeuNoPoste }
  ];

  const resultados = [];

  for(const f of fontes){
    const dados = await f.fn();
    const validos = dados.filter(resultadoValido);
    const score = calcularScore(validos);

    resultados.push({
      nome: f.nome,
      dados: validos,
      score
    });

    console.log(`📊 ${f.nome}: score ${score}`);
  }

  // ordena por melhor score
  resultados.sort((a,b)=>b.score-a.score);

  const melhor = resultados[0];

  console.log("🏆 fonte escolhida:", melhor.nome);

  return melhor.dados;
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvar(lista){

  const hoje = new Date().toISOString().split("T")[0];

  const ops = lista.map(r=>({
    updateOne:{
      filter:{ uniqueId:`${hoje}-${r.p1}-${r.p2}-${r.p3}` },
      update:{ ...r, data:hoje, banca:"rio" },
      upsert:true
    }
  }));

  if(ops.length) await Resultado.bulkWrite(ops);
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function historico(){
  const dados = await Resultado.find().lean();
  const h = {};

  dados.forEach(r=>{
    if(!resultadoValido(r)) return;

    if(!h[r.data]){
      h[r.data]={ rio:[] };
    }

    h[r.data].rio.push(r);
  });

  return h;
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////

let cache=null;
let tempo=0;

async function carregar(){

  const agora = Date.now();

  if(cache && (agora-tempo<60000)) return cache;

  const melhor = await escolherMelhorFonte();

  if(melhor.length){
    await salvar(melhor);
  }else{
    console.log("⚠️ nenhuma fonte válida");
  }

  const h = await historico();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico: h
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTAS
//////////////////////////////////////////////////

app.get("/resultados", async(req,res)=>{
  try{
    res.json(await carregar());
  }catch(e){
    res.status(500).json({erro:e.message});
  }
});

app.listen(PORT, ()=>console.log("🚀 rodando",PORT));