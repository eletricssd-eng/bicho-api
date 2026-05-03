import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import https from "https";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (Linux; Android 10)",
  "Mozilla/5.0 (iPhone)"
];

const delay = ms => new Promise(r => setTimeout(r, ms));

//////////////////////////////////////////////////
// 🔥 FETCH
//////////////////////////////////////////////////

async function fetch(url){

  try{
    const res = await axios.get(url, {
      timeout: 15000,
      httpsAgent,
      headers:{
        "User-Agent": USER_AGENTS[Math.random()*USER_AGENTS.length | 0]
      }
    });

    return res.data;

  }catch{
    console.log("❌ erro fetch:", url);
    return null;
  }
}

//////////////////////////////////////////////////
// 🔥 LIMPEZA
//////////////////////////////////////////////////

function limparNumeros(nums){
  return nums.filter(n => {
    if(!/^\d{4}$/.test(n)) return false;
    if(/^(\d)\1{3}$/.test(n)) return false;
    return true;
  });
}

//////////////////////////////////////////////////
// 🧠 HORÁRIO
//////////////////////////////////////////////////

function extrairHorario(texto){
  if(!texto) return "extra";

  const match = texto.match(/\d{1,2}:\d{2}|\d{1,2}h/);

  if(!match) return "extra";

  let h = match[0].replace("h", ":00");

  const [hora, min] = h.split(":");

  return `${hora.padStart(2,"0")}:${min}`;
}

//////////////////////////////////////////////////
// 🔥 SCRAPER MELHORADO
//////////////////////////////////////////////////

async function scraper(url){

  const html = await fetch(url);

  if(!html) return [];

  try{

    const $ = cheerio.load(html);

    let resultados = [];

    // TABELA
    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text();

      let nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/g);
        if(match) nums.push(...match);
      });

      nums = limparNumeros(nums);

      if(nums.length >= 5){

        resultados.push({
          horario: extrairHorario(titulo),
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }
    });

    // 🔥 FALLBACK INTELIGENTE
    if(resultados.length === 0){

      let nums = $("body").text().match(/\d{4}/g);

      if(nums){

        nums = limparNumeros(nums);

        for(let i = 0; i < nums.length; i += 5){

          const bloco = nums.slice(i, i+5);

          if(bloco.length === 5){

            resultados.push({
              horario: "extra",
              p1: bloco[0],
              p2: bloco[1],
              p3: bloco[2],
              p4: bloco[3],
              p5: bloco[4]
            });
          }
        }
      }
    }

    console.log("📊", url, resultados.length);

    return resultados;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTES
//////////////////////////////////////////////////

const FONTES = [
  "https://bichodata.com",
  "https://ejogodobicho.com",
  "https://playbicho.com/resultado-jogo-do-bicho",
  "https://www.resultadodobichohoje.com.br/rio"
];

//////////////////////////////////////////////////
// 🚀 PIPELINE
//////////////////////////////////////////////////

async function pegarTudo(){

  const resultados = await Promise.all(
    FONTES.map(f => scraper(f))
  );

  let todos = resultados.flat();

  if(todos.length === 0){
    console.log("⚠️ SEM DADOS REAIS");
    return { rio: [], look: [], nacional: [], federal: [] };
  }

  // dedup
  const mapa = new Map();

  todos.forEach(r=>{
    const chave = `${r.horario}-${r.p1}-${r.p2}`;
    if(!mapa.has(chave)){
      mapa.set(chave, r);
    }
  });

  const limpo = Array.from(mapa.values());

  return {
    rio: limpo.filter(r => r.horario <= "18:00"),
    look: limpo.filter(r => r.horario >= "19:00"),
    nacional: limpo,
    federal: []
  };
}

//////////////////////////////////////////////////
// 🚀 API
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{
  const dados = await pegarTudo();
  res.json({
    atualizado: new Date().toLocaleString("pt-BR"),
    historico: dados
  });
});

app.listen(PORT, ()=>{
  console.log("🚀 rodando", PORT);
});