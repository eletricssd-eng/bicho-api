import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const __dirname = new URL('.', import.meta.url).pathname;
const DB = path.join(__dirname, "dados.json");

// cria banco se não existir
if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]");
}

//////////////////////////////////////////////////
// 🧠 HORÁRIOS REAIS (RIO)
//////////////////////////////////////////////////

const HORARIOS = ["09:20","11:20","14:20","16:20","18:20","21:20"];

//////////////////////////////////////////////////
// 📅 FORMATAR DATA REAL
//////////////////////////////////////////////////

function formatarData(txt){

  if(!txt) return new Date().toISOString().split("T")[0];

  const match = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);

  if(match){
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🌐 PEGAR HISTÓRICO REAL
//////////////////////////////////////////////////

async function pegarDados(){

  try{

    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.ojogodobicho.com/resultadosanteriores.htm",
      { timeout: 15000 }
    );

    const $ = cheerio.load(data);

    let resultados = [];
    let index = 0;

    $("table tr").each((i,el)=>{

      const col = $(el).find("td");

      if(col.length >= 6){

        const dataTxt = $(col[0]).text().trim();

        const grupoObj = {
          banca: "rio",
          data: formatarData(dataTxt),
          horario: HORARIOS[index % 6],
          resultados: []
        };

        for(let i=2;i<=6;i++){

          const bruto = $(col[i]).text().trim();

          const match = bruto.match(/(\d{4})-(\d+)/);

          if(match){

            const milhar = match[1];
            const grupo = match[2];
            const dezena = milhar.slice(-2);

            grupoObj.resultados.push({
              pos: i-1,
              numero: milhar,
              grupo,
              dezena
            });
          }
        }

        if(grupoObj.resultados.length){
          resultados.push(grupoObj);
          index++;
        }
      }

    });

    return resultados.slice(0,6);

  }catch(e){
    console.log("❌ ERRO SCRAPING:", e.message);
    return [];
  }
}

//////////////////////////////////////////////////
// 💾 SALVAR (7 DIAS)
//////////////////////////////////////////////////

function salvar(novos){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const todos = [...novos, ...antigos];

  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  const filtrado = todos.filter(d =>
    new Date(d.data) >= limite
  );

  fs.writeFileSync(DB, JSON.stringify(filtrado,null,2));
}

//////////////////////////////////////////////////
// 📊 ANALISAR FORTE
//////////////////////////////////////////////////

function analisar(dados){

  let contagem = {};
  let ultimoVisto = {};

  dados.forEach((d,idx)=>{
    d.resultados.forEach(r=>{

      contagem[r.dezena] = (contagem[r.dezena] || 0) + 1;

      if(!ultimoVisto[r.dezena]){
        ultimoVisto[r.dezena] = idx;
      }

    });
  });

  const mais_fortes = Object.entries(contagem)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  const atrasados = Object.keys(contagem)
    .sort((a,b)=>ultimoVisto[b] - ultimoVisto[a])
    .slice(0,10);

  return { mais_fortes, atrasados };
}

//////////////////////////////////////////////////
// 🎯 PALPITE INTELIGENTE
//////////////////////////////////////////////////

function gerarPalpite(analise){

  const fortes = analise.mais_fortes.map(x=>x[0]);
  const atrasados = analise.atrasados;

  if(!fortes.length) return ["00","11","22"];

  let palpites = [];

  for(let i=0;i<3;i++){

    if(Math.random() > 0.5){
      palpites.push(fortes[Math.floor(Math.random()*fortes.length)]);
    }else{
      palpites.push(atrasados[Math.floor(Math.random()*atrasados.length)]);
    }

  }

  return palpites;
}

//////////////////////////////////////////////////
// 🌐 ROTA PRINCIPAL
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  try{

    const novos = await pegarDados();

    if(novos.length){
      salvar(novos);
    }

    let dados = [];

    try{
      dados = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const analise = analisar(dados);
    const palpite = gerarPalpite(analise);

    res.json({
      fonte: "real-banca",
      total: dados.length,
      rio: dados,
      nacional: [],
      look: [],
      federal: [],
      analise,
      palpite
    });

  }catch(e){

    res.json({
      erro: "falha geral",
      rio: []
    });

  }

});

//////////////////////////////////////////////////
// TESTE
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("API BANCA PROFISSIONAL 🚀");
});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando na porta", PORT);
});