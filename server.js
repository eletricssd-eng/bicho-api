import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const HISTORICO_FILE = "./dados.json";

//////////////////////////////////////////////////
// 🔍 SCRAPER (BLINDADO)
//////////////////////////////////////////////////

async function scraper(url){
  try{
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      const bloco = $(tabela).closest("div");

      let titulo = bloco.find("h2, h3, strong").first().text().trim();

      if(!titulo || titulo.length < 5){
        titulo = "Horário " + (i+1);
      }

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{

        if(i >= 5) return; // ✅ só 1º ao 5º prêmio

        const texto = $(tr).text();
        const match = texto.match(/\d{4}/);

        if(match) nums.push(match[0]);

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
  return await scraper("https://www.resultadofacil.com.br/resultado-banca-federal");
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

  historico[dataBase] = dadosHoje;

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

  // ✅ evita salvar vazio
  if(
    dadosHoje.rio.length ||
    dadosHoje.look.length ||
    dadosHoje.nacional.length ||
    dadosHoje.federal.length
  ){
    salvarHistorico(dadosHoje);
  }

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