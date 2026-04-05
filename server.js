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

// cria arquivo se não existir
if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]");
}

//////////////////////////////////////////////////
// 📅 DATA HOJE
//////////////////////////////////////////////////

function hoje(){
  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🌐 PEGAR HISTÓRICO REAL (6 DIAS)
//////////////////////////////////////////////////

async function pegarDados(){

  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.ojogodobicho.com/resultadosanteriores.htm",
      { timeout: 15000 }
    );

    const $ = cheerio.load(data);

    let resultados = [];

    $("table tr").each((i,el)=>{

      const col = $(el).find("td");

      if(col.length >= 6){

        const grupoObj = {
          banca: "rio",
          data: hoje(),
          horario: "",
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
// 💾 SALVAR HISTÓRICO
//////////////////////////////////////////////////

function salvar(dados){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const todos = [...antigos, ...dados];

  // manter últimos 7 dias
  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  const filtrado = todos.filter(d =>
    new Date(d.data) >= limite
  );

  fs.writeFileSync(DB, JSON.stringify(filtrado,null,2));
}

//////////////////////////////////////////////////
// 📊 ANALISAR
//////////////////////////////////////////////////

function analisar(dados){

  let contagem = {};

  dados.forEach(d=>{
    d.resultados.forEach(r=>{
      contagem[r.dezena] = (contagem[r.dezena] || 0) + 1;
    });
  });

  const ordenado = Object.entries(contagem)
    .sort((a,b)=>b[1]-a[1]);

  return {
    mais_fortes: ordenado.slice(0,10),
    atrasados: ordenado.slice(-10)
  };
}

//////////////////////////////////////////////////
// 🎯 PALPITE INTELIGENTE
//////////////////////////////////////////////////

function gerarPalpite(analise){

  if(!analise.mais_fortes.length){
    return ["00","11","22"];
  }

  return analise.mais_fortes
    .slice(0,3)
    .map(x=>x[0]);
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
      fonte: "real-historico",
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
  res.send("API BANCA ONLINE 🚀");
});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando porta", PORT);
});