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

if (!fs.existsSync(DB)) fs.writeFileSync(DB, "[]");

//////////////////////////////////////////////////
// 🧠 HORÁRIOS REAIS
//////////////////////////////////////////////////

const HORARIOS = ["09:20","11:20","14:20","16:20","18:20","21:20"];

//////////////////////////////////////////////////
// 📅 DATA REAL
//////////////////////////////////////////////////

function extrairData(texto){
  const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(match) return `${match[3]}-${match[2]}-${match[1]}`;
  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🧹 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista, banca){
  return lista.map(item => ({
    banca,
    data: item.data,
    horario: item.horario,
    resultados: item.resultados.map(r => ({
      pos: Number(r.pos),
      numero: String(r.numero).padStart(4,"0"),
      grupo: r.grupo || "",
      dezena: String(r.numero).slice(-2)
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 RIO (HTML REAL)
//////////////////////////////////////////////////

async function fonteRio(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.ojogodobicho.com/resultadosanteriores.htm"
    );

    const $ = cheerio.load(data);
    let lista = [];
    let index = 0;

    $("table tr").each((i,el)=>{
      const col = $(el).find("td");

      if(col.length >= 6){

        const dataTxt = $(col[0]).text().trim();
        const dataReal = extrairData(dataTxt);

        let resultados = [];

        for(let i=2;i<=6;i++){
          const txt = $(col[i]).text().trim();
          const match = txt.match(/\d{4}/);

          if(match){
            resultados.push({
              pos: i-1,
              numero: match[0]
            });
          }
        }

        if(resultados.length === 5){
          lista.push({
            data: dataReal,
            horario: HORARIOS[index % 6],
            resultados
          });
          index++;
        }
      }
    });

    return normalizar(lista,"rio");

  }catch(e){
    console.log("❌ rio erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 NACIONAL (API)
//////////////////////////////////////////////////

async function fonteNacional(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://app.centraldobichobrasil.com/api/results"
    );

    if(!data || !data.length) return [];

    const lista = data.map(item => ({
      data: item.date,
      horario: item.time || "",
      resultados: item.results.map((r,i)=>({
        pos: i+1,
        numero: r.number
      }))
    }));

    return normalizar(lista,"nacional");

  }catch(e){
    console.log("❌ nacional erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 LOOK (SCRAPING)
//////////////////////////////////////////////////

async function fonteLook(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://resultadofacil.com.br/resultado-do-jogo-do-bicho/"
    );

    const $ = cheerio.load(data);
    let lista = [];

    $("table tr").each((i,el)=>{
      const col = $(el).find("td");

      if(col.length >= 2){
        const numero = $(col[1]).text().trim();

        if(numero.match(/\d{4}/)){
          lista.push({
            data: new Date().toISOString().split("T")[0],
            horario: "",
            resultados:[{
              pos: 1,
              numero
            }]
          });
        }
      }
    });

    return normalizar(lista,"look");

  }catch(e){
    console.log("❌ look erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FEDERAL (fallback simples)
//////////////////////////////////////////////////

async function fonteFederal(){
  return [];
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
// 📊 ANALISAR
//////////////////////////////////////////////////

function analisar(dados){

  let mapa = {};
  let porHorario = {};

  dados.forEach(d=>{
    if(!porHorario[d.horario]) porHorario[d.horario] = {};

    d.resultados.forEach(r=>{
      mapa[r.dezena] = (mapa[r.dezena] || 0) + 1;
      porHorario[d.horario][r.dezena] =
        (porHorario[d.horario][r.dezena] || 0) + 1;
    });
  });

  return {
    mais_fortes: Object.entries(mapa).sort((a,b)=>b[1]-a[1]).slice(0,10),
    por_horario: porHorario
  };
}

//////////////////////////////////////////////////
// 🎯 PALPITE
//////////////////////////////////////////////////

function gerarPalpite(analise){

  const hora = new Date().getHours();

  let alvo = "18:20";

  if(hora < 11) alvo = "11:20";
  else if(hora < 14) alvo = "14:20";
  else if(hora < 16) alvo = "16:20";
  else if(hora < 18) alvo = "18:20";
  else alvo = "21:20";

  const lista = analise.por_horario[alvo] || {};

  const top = Object.entries(lista)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3);

  if(!top.length) return ["00","11","22"];

  return top.map(x=>x[0]);
}

//////////////////////////////////////////////////
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  try{

    const rio = await fonteRio();
    const nacional = await fonteNacional();
    const look = await fonteLook();
    const federal = await fonteFederal();

    const todos = [...rio, ...nacional, ...look, ...federal];

    if(todos.length) salvar(todos);

    let banco = [];

    try{
      banco = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const separado = {
      rio: banco.filter(x=>x.banca==="rio"),
      nacional: banco.filter(x=>x.banca==="nacional"),
      look: banco.filter(x=>x.banca==="look"),
      federal: banco.filter(x=>x.banca==="federal")
    };

    const analise = {
      rio: analisar(separado.rio),
      nacional: analisar(separado.nacional),
      look: analisar(separado.look),
      federal: analisar(separado.federal)
    };

    const palpite = gerarPalpite(analise.rio);

    res.json({
      fonte: "banca-real-total",
      total: banco.length,
      ...separado,
      analise,
      palpite
    });

  }catch(e){

    res.json({
      erro: "falha geral",
      rio:[]
    });

  }

});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando na porta", PORT);
});