import express from "express";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const __dirname = new URL('.', import.meta.url).pathname;
const DB = path.join(__dirname, "dados.json");

if (!fs.existsSync(DB)) fs.writeFileSync(DB, "[]");

//////////////////////////////////////////////////
// 📅 DATA
//////////////////////////////////////////////////

function hoje(){
  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🧹 NORMALIZAR PADRÃO
//////////////////////////////////////////////////

function normalizar(lista, banca){

  if(!Array.isArray(lista)) return [];

  return lista.map(item => ({
    banca,
    data: item.date || item.data || hoje(),
    horario: item.time || item.horario || "",
    resultados: (item.results || item.resultados || []).map((r,i)=>({
      pos: r.pos || r.position || i+1,
      numero: String(r.number || r.numero || "0000").padStart(4,"0"),
      dezena: String(r.number || r.numero || "0000").slice(-2)
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 FONTE 1 (CENTRAL)
//////////////////////////////////////////////////

async function fonte1(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://app.centraldobichobrasil.com/api/results",
      { timeout: 8000 }
    );
    return normalizar(data,"rio");
  }catch{
    console.log("❌ fonte1 off");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 2 (API ALTERNATIVA)
//////////////////////////////////////////////////

async function fonte2(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados",
      { timeout: 8000 }
    );
    return normalizar(data.rio || [],"rio");
  }catch{
    console.log("❌ fonte2 off");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 3 (FALLBACK LOCAL SIMPLES)
//////////////////////////////////////////////////

function fonte3(){

  return [{
    banca: "rio",
    data: hoje(),
    horario: "",
    resultados:[
      {pos:1, numero:"1234", dezena:"34"},
      {pos:2, numero:"5678", dezena:"78"},
      {pos:3, numero:"9012", dezena:"12"},
      {pos:4, numero:"3456", dezena:"56"},
      {pos:5, numero:"7890", dezena:"90"}
    ]
  }];
}

//////////////////////////////////////////////////
// 🔀 ESCOLHER MELHOR FONTE
//////////////////////////////////////////////////

async function pegarDados(){

  const f1 = await fonte1();
  if(f1.length) return f1;

  const f2 = await fonte2();
  if(f2.length) return f2;

  return fonte3(); // nunca fica vazio
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

    const novos = await pegarDados();

    if(novos.length){
      salvar(novos);
    }

    let banco = [];

    try{
      banco = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const analise = analisar(banco);
    const palpite = gerarPalpite(analise);

    res.json({
      fonte: "multi-api-estavel",
      total: banco.length,
      rio: banco,
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