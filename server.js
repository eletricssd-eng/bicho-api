import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🔥 MONGO
const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
.then(()=> console.log("✅ Mongo conectado"))
.catch(err => console.log("❌ erro mongo:", err));

// 📦 MODEL
const ResultadoSchema = new mongoose.Schema({
  data: String,
  rio: Array,
  look: Array,
  nacional: Array,
  federal: Array
});

const Resultado = mongoose.model("Resultado", ResultadoSchema);

//////////////////////////////////////////////////
// 🔍 SCRAPER (SEM PUPPETEER = NÃO QUEBRA NO RENDER)
//////////////////////////////////////////////////

async function scraper(url){
  try{
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela)
        .prevAll("h2, h3, strong")
        .first()
        .text()
        .trim();

      if(!titulo || titulo.length < 3){
        titulo = "Horário " + (i+1);
      }

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const texto = $(tr).text();
        const match = texto.match(/\d{4}/);
        if(match) nums.push(match[0]);
      });

      const tituloLower = titulo.toLowerCase();

      const isFederal = tituloLower.includes("federal");
      const is10 = tituloLower.includes("1 ao 10") || tituloLower.includes("10º");

      if(isFederal && is10) return;

      if(nums.length >= 5){

        lista.push({
          horario: titulo
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
  return {
    rio: await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    look: await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    nacional: await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje")
  };
}

//////////////////////////////////////////////////
// 🇧🇷 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){

  let lista = await scraper("https://www.resultadofacil.com.br/resultado-banca-federal");

  return lista.map(item => ({
    horario: item.horario,
    p1: item.p1,
    p2: item.p2,
    p3: item.p3,
    p4: item.p4,
    p5: item.p5
  }));
}

//////////////////////////////////////////////////
// 💾 SALVAR NO MONGO
//////////////////////////////////////////////////

async function salvarHistorico(dadosHoje){

  const dataHoje = new Date().toISOString().split("T")[0];

  let doc = await Resultado.findOne({ data: dataHoje });

  if(!doc){

    await Resultado.create({
      data: dataHoje,
      ...dadosHoje
    });

  }else{

    const bancas = ["rio","look","nacional","federal"];

    bancas.forEach(banca => {

      const antigos = doc[banca] || [];
      const novos = dadosHoje[banca] || [];

      const mapa = {};

      antigos.forEach(i => mapa[i.horario] = i);
      novos.forEach(i => mapa[i.horario] = i);

      doc[banca] = Object.values(mapa);

    });

    await doc.save();
  }
}

//////////////////////////////////////////////////
// 📊 LER HISTÓRICO
//////////////////////////////////////////////////

async function lerHistorico(){

  const docs = await Resultado.find()
    .sort({ data: -1 })
    .limit(7);

  const historico = {};

  docs.forEach(d=>{
    historico[d.data] = {
      rio: d.rio || [],
      look: d.look || [],
      nacional: d.nacional || [],
      federal: d.federal || []
    };
  });

  return historico;
}

//////////////////////////////////////////////////
// 🚀 CACHE + UPDATE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo(){

  const agora = Date.now();

  if(cache && agora - tempo < 60000){
    return cache;
  }

  console.log("🔄 Atualizando dados...");

  const bancas = await pegarBancas();
  const federal = await pegarFederal();

  const dadosHoje = {
    ...bancas,
    federal
  };

  await salvarHistorico(dadosHoje);

  const historico = await lerHistorico();

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
  const dados = await carregarTudo();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 API PROFISSIONAL rodando na porta", PORT);
});