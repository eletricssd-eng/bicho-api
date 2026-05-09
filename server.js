import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";
import mongoose from "mongoose";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const HISTORICO_FILE = "./historico.json";

//////////////////////////////////////////////////
// 🇧🇷 TIMEZONE BRASIL (CORREÇÃO PRINCIPAL)
//////////////////////////////////////////////////

function agoraBR(){
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function hojeBR(){
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Sao_Paulo"
  }); // YYYY-MM-DD
}

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
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url){
  try{
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    const tabelas = $("table");

    tabelas.each((i, tabela)=>{

      let titulo = "";

      const prev = $(tabela).prevAll("h2, h3, strong").first();

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
        if(match) nums.push(match[0]);
      });

      // 🔥 FILTRO PRINCIPAL (AQUI ESTÁ A CORREÇÃO)
      const tituloLower = titulo.toLowerCase();

      const isFederal = tituloLower.includes("federal");

      const is10 = tituloLower.includes("1 ao 10") || tituloLower.includes("10º");
      const is5  = tituloLower.includes("1 ao 5") || tituloLower.includes("5º");

      // ❌ remove versão errada da federal
      if(isFederal && is10) return;

      // ✅ garante só 1 ao 5
      if(nums.length >= 5){

        lista.push({
          horario: titulo
            .replace(/1 ao 10º?/gi, "")
            .replace(/1 ao 5º?/gi, "")
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
// 🇧🇷 FEDERAL (CORRIGIDA)
//////////////////////////////////////////////////

async function pegarFederal(){
  let lista = await scraper("https://www.resultadofacil.com.br/resultado-banca-federal");

  // 🔥 FORÇA PADRÃO 1 AO 5 + LIMPA TEXTO
  lista = lista.map(item => ({
    horario: item.horario
      .replace(/1 ao 10º?/gi, "")
      .replace(/1 ao 5º?/gi, "")
      .replace(/resultado do dia/gi, "")
      .trim(),

    p1: item.p1,
    p2: item.p2,
    p3: item.p3,
    p4: item.p4,
    p5: item.p5
  }));

  lista = lista.slice(0,1); // 🔥 garante só 1 resultado
  return lista;
}

//////////////////////////////////////////////////
// 💾 SALVAR (SEM DUPLICAR)
//////////////////////////////////////////////////

async function salvarMongo(dados){

  if(mongoose.connection.readyState !== 1){
    console.log("⚠️ Mongo offline - não salvou");
    return;
  }

  const hoje = hojeBR();

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
// 💾 HISTÓRICO
//////////////////////////////////////////////////

function lerHistorico(){
  try{
    if(!fs.existsSync(HISTORICO_FILE)) return {};
    const data = fs.readFileSync(HISTORICO_FILE);
    if(!data || data.length === 0) return {};
    return JSON.parse(data);
  }catch{
    return {};
  }
}

function salvarHistorico(dadosHoje){

  let historico = lerHistorico();

  let dataBase = hojeBR();

  try{
    const exemplo =
      dadosHoje.rio?.[0]?.horario ||
      dadosHoje.look?.[0]?.horario ||
      dadosHoje.nacional?.[0]?.horario ||
      dadosHoje.federal?.[0]?.horario;

    const match = exemplo?.match(/\d{2}\/\d{2}\/\d{4}/);

    if(match){
      const [d,m,a] = match[0].split("/");
      dataBase = `${a}-${m}-${d}`;
    }

  }catch{}

  // 🔥 garante estrutura
  if(!historico[dataBase]){
    historico[dataBase] = {
      rio: [],
      look: [],
      nacional: [],
      federal: []
    };
  }

  const bancas = ["rio","look","nacional","federal"];

  bancas.forEach(banca => {

    const novos = dadosHoje[banca] || [];
    const antigos = historico[dataBase][banca] || [];

    // 🔥 remove duplicados por horário
    const mapa = {};

    antigos.forEach(i => mapa[i.horario] = i);
    novos.forEach(i => mapa[i.horario] = i);

    historico[dataBase][banca] = Object.values(mapa);

  });

  // 🔥 mantém só 7 dias
  const datas = Object.keys(historico)
    .sort((a,b)=> new Date(b) - new Date(a))
    .slice(0,7);

  const novo = {};
  datas.forEach(d => novo[d] = historico[d]);

  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(novo, null, 2));
}

//////////////////////////////////////////////////
// 🚀 MAIN
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

  await salvarMongo(dadosHoje);

  salvarHistorico(dadosHoje);

  const historico = lerHistorico();

  cache = {
    atualizado: agoraBR(),
    historico
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{
  const dados = await carregarTudo();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 Server rodando na porta", PORT);
});