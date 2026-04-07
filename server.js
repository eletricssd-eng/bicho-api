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
// 📅 EXTRAIR DATA REAL
//////////////////////////////////////////////////

function extrairData(texto){
  if(!texto) return null;

  let m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
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
      dezena: String(r.numero).slice(-2)
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 FONTE RIO
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

        const dataReal = extrairData($(col[0]).text().trim());
        if(!dataReal) return;

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

  }catch{
    console.log("❌ erro rio");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE API
//////////////////////////////////////////////////

async function fonteAPI(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados"
    );

    return normalizar(data.rio || [],"rio");

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE EXTRA
//////////////////////////////////////////////////

async function fonteExtra(){
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
            resultados:[{ pos:1, numero }]
          });
        }
      }
    });

    return normalizar(lista,"rio");

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🔥 VALIDAÇÃO CRUZADA
//////////////////////////////////////////////////

function validarResultados(fontes){

  const mapa = {};

  fontes.flat().forEach(item=>{
    item.resultados.forEach(r=>{

      const chave = `${item.data}-${item.horario}-${r.pos}-${r.dezena}`;

      if(!mapa[chave]){
        mapa[chave] = {
          banca: item.banca,
          data: item.data,
          horario: item.horario,
          resultados: [],
          confirmacoes: 0
        };
      }

      mapa[chave].confirmacoes++;
      mapa[chave].resultados.push(r);

    });
  });

  return Object.values(mapa).filter(x => x.confirmacoes >= 2);
}

//////////////////////////////////////////////////
// 🧠 AGRUPAR
//////////////////////////////////////////////////

function agrupar(lista){

  const mapa = {};

  lista.forEach(item=>{
    const chave = item.data + "-" + item.horario;

    if(!mapa[chave]){
      mapa[chave] = {
        banca: item.banca,
        data: item.data,
        horario: item.horario,
        resultados: []
      };
    }

    mapa[chave].resultados.push(...item.resultados);
  });

  return Object.values(mapa);
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
// 📊 ANALISE
//////////////////////////////////////////////////

function analisar(dados){

  let mapa = {};

  dados.forEach(d=>{
    d.resultados.forEach(r=>{
      mapa[r.dezena] = (mapa[r.dezena] || 0) + 1;
    });
  });

  return Object.entries(mapa)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);
}

//////////////////////////////////////////////////
// 🎯 PALPITE
//////////////////////////////////////////////////

function gerarPalpite(analise){

  if(!analise.length) return ["00","11","22"];

  return analise.slice(0,3).map(x=>x[0]);
}

//////////////////////////////////////////////////
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  try{

    const f1 = await fonteRio();
    const f2 = await fonteAPI();
    const f3 = await fonteExtra();

    const validados = validarResultados([f1,f2,f3]);
    const dados = agrupar(validados);

    if(dados.length) salvar(dados);

    let banco = [];

    try{
      banco = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const rio = banco.filter(x=>x.banca==="rio");

    const analise = analisar(rio);
    const palpite = gerarPalpite(analise);

    res.json({
      fonte: "banca-validada",
      total: banco.length,
      rio,
      analise,
      palpite
    });

  }catch(e){

    res.json({
      erro:"falha geral",
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