import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const HISTORICO_FILE = "./historico.json";

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

      let titulo = "";
      const prev = $(tabela).prevAll("h2, h3, strong").first();

      if(prev.length){
        titulo = prev.text().trim();
      }

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

      // ❌ ignora federal errado
      if(isFederal && is10) return;

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
// 🇧🇷 FEDERAL
//////////////////////////////////////////////////

async function pegarFederal(){
  let lista = await scraper("https://www.resultadofacil.com.br/resultado-banca-federal");

  return lista.map(item => ({
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
}

//////////////////////////////////////////////////
// 💾 HISTÓRICO
//////////////////////////////////////////////////

function lerHistorico(){
  try{
    if(!fs.existsSync(HISTORICO_FILE)) return {};
    return JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }catch{
    return {};
  }
}

function salvarHistorico(dadosHoje){

  let historico = lerHistorico();
  const hoje = new Date().toISOString().split("T")[0];

  if(!historico[hoje]){
    historico[hoje] = {
      rio: [],
      look: [],
      nacional: [],
      federal: []
    };
  }

  const bancas = ["rio","look","nacional","federal"];

  bancas.forEach(banca => {

    const novos = dadosHoje[banca] || [];
    const antigos = historico[hoje][banca] || [];

    const mapa = {};

    antigos.forEach(i => mapa[i.horario] = i);
    novos.forEach(i => mapa[i.horario] = i);

    historico[hoje][banca] = Object.values(mapa);

  });

  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(historico, null, 2));
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

  console.log("🔄 Atualizando...");

  const bancas = await pegarBancas();
  const federal = await pegarFederal();

  const dadosHoje = {
    ...bancas,
    federal
  };

  salvarHistorico(dadosHoje);

  const historico = lerHistorico();

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
  res.send("✅ API DO BICHO ONLINE");
});

app.get("/resultados", async (req,res)=>{
  const dados = await carregarTudo();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 Rodando na porta", PORT);
});