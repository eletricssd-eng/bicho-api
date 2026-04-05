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

// cria banco
if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]");
}

//////////////////////////////////////////////////
// 🧠 HORÁRIOS REAIS
//////////////////////////////////////////////////

const HORARIOS = ["09:20","11:20","14:20","16:20","18:20","21:20"];

//////////////////////////////////////////////////
// 📅 FORMATAR DATA
//////////////////////////////////////////////////

function formatarData(txt){
  const match = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(match){
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🌐 SCRAPING HISTÓRICO REAL
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
// 📊 ANALISAR (GERAL + HORÁRIO)
//////////////////////////////////////////////////

function analisar(dados){

  let geral = {};
  let porHorario = {};

  dados.forEach(d=>{

    if(!porHorario[d.horario]){
      porHorario[d.horario] = {};
    }

    d.resultados.forEach(r=>{

      geral[r.dezena] = (geral[r.dezena] || 0) + 1;

      porHorario[d.horario][r.dezena] =
        (porHorario[d.horario][r.dezena] || 0) + 1;

    });

  });

  const mais_fortes = Object.entries(geral)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  let rankingHorario = {};

  Object.keys(porHorario).forEach(h=>{
    rankingHorario[h] = Object.entries(porHorario[h])
      .sort((a,b)=>b[1]-a[1])
      .slice(0,5);
  });

  return {
    mais_fortes,
    por_horario: rankingHorario
  };
}

//////////////////////////////////////////////////
// 🎯 PALPITE INTELIGENTE POR HORÁRIO
//////////////////////////////////////////////////

function gerarPalpite(analise){

  const agora = new Date().getHours();

  let horarioAlvo = "18:20";

  if(agora < 11) horarioAlvo = "11:20";
  else if(agora < 14) horarioAlvo = "14:20";
  else if(agora < 16) horarioAlvo = "16:20";
  else if(agora < 18) horarioAlvo = "18:20";
  else horarioAlvo = "21:20";

  const lista = analise.por_horario[horarioAlvo] || [];

  if(!lista.length){
    return ["00","11","22"];
  }

  return lista.slice(0,3).map(x=>x[0]);
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
      fonte: "real-banca-pro",
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
  res.send("API BANCA PRO 🔥");
});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando na porta", PORT);
});