import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
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

  return lista;
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

  let dataBase = new Date().toISOString().split("T")[0];

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