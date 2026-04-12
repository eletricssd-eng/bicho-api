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
// 🐾 GRUPOS
//////////////////////////////////////////////////

const grupos = [
  ["Avestruz", ["01","02","03","04"]],
  ["Águia", ["05","06","07","08"]],
  ["Burro", ["09","10","11","12"]],
  ["Borboleta", ["13","14","15","16"]],
  ["Cachorro", ["17","18","19","20"]],
  ["Cabra", ["21","22","23","24"]],
  ["Carneiro", ["25","26","27","28"]],
  ["Camelo", ["29","30","31","32"]],
  ["Cobra", ["33","34","35","36"]],
  ["Coelho", ["37","38","39","40"]],
  ["Cavalo", ["41","42","43","44"]],
  ["Elefante", ["45","46","47","48"]],
  ["Galo", ["49","50","51","52"]],
  ["Gato", ["53","54","55","56"]],
  ["Jacaré", ["57","58","59","60"]],
  ["Leão", ["61","62","63","64"]],
  ["Macaco", ["65","66","67","68"]],
  ["Porco", ["69","70","71","72"]],
  ["Pavão", ["73","74","75","76"]],
  ["Peru", ["77","78","79","80"]],
  ["Touro", ["81","82","83","84"]],
  ["Tigre", ["85","86","87","88"]],
  ["Urso", ["89","90","91","92"]],
  ["Veado", ["93","94","95","96"]],
  ["Vaca", ["97","98","99","00"]],
];

function getGrupo(num){
  if(!num) return null;
  const final = num.slice(-2);
  for (let [nome, lista] of grupos){
    if(lista.includes(final)) return nome;
  }
  return null;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (SEGURO)
//////////////////////////////////////////////////

async function scraper(url){
  try{
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("h2, h3").each((i, el)=>{

      const titulo = $(el).text().trim();
      const tabela = $(el).nextAll("table").first();
      if(!tabela.length) return;

      const nums = [];

      tabela.find("tr").each((i,tr)=>{
        const t = $(tr).text();
        const m = t.match(/\d{4}/);
        if(m) nums.push(m[0]);
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
    console.log("erro scraper:", url);
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
// 🇧🇷 FEDERAL (APENAS 1º AO 5º)
//////////////////////////////////////////////////

async function pegarFederal(){
  try{
    const { data } = await axios.get(
      "https://www.resultadofacil.com.br/resultado-banca-federal",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $ = cheerio.load(data);
    let lista = [];

    $("h2, h3").each((i, el)=>{

      const titulo = $(el).text().trim();
      if(!titulo.toLowerCase().includes("federal")) return;

      const tabela = $(el).nextAll("table").first();
      if(!tabela.length) return;

      const nums = [];

      tabela.find("tr").each((i,tr)=>{
        const t = $(tr).text();
        const m = t.match(/\d{4}/);
        if(m) nums.push(m[0]);
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

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 💾 HISTÓRICO (BLINDADO)
//////////////////////////////////////////////////

function salvarHistorico(dadosHoje){

  let historico = {};

  if(fs.existsSync(HISTORICO_FILE)){
    try{
      historico = JSON.parse(fs.readFileSync(HISTORICO_FILE));
    }catch{
      historico = {};
    }
  }

  let dataBase = new Date().toISOString().split("T")[0];

  try{
    const exemplo =
      dadosHoje.rio?.[0]?.horario ||
      dadosHoje.look?.[0]?.horario ||
      dadosHoje.nacional?.[0]?.horario;

    const m = exemplo?.match(/\d{2}\/\d{2}\/\d{4}/);

    if(m){
      const [d,mn,a] = m[0].split("/");
      dataBase = `${a}-${mn}-${d}`;
    }

  }catch{}

  historico[dataBase] = dadosHoje;

  const datas = Object.keys(historico)
    .sort((a,b)=> new Date(b)-new Date(a))
    .slice(0,7);

  const novo = {};
  datas.forEach(d=> novo[d] = historico[d]);

  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(novo,null,2));
}

function lerHistorico(){
  try{
    if(!fs.existsSync(HISTORICO_FILE)) return {};
    return JSON.parse(fs.readFileSync(HISTORICO_FILE));
  }catch{
    return {};
  }
}

//////////////////////////////////////////////////
// 🚀 PRINCIPAL
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo(){

  const agora = Date.now();

  if(cache && agora - tempo < 60000) return cache;

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

app.listen(PORT, ()=>{
  console.log("🚀 server rodando");
});