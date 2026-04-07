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
// 🧠 BANCAS + HORÁRIOS REAIS
//////////////////////////////////////////////////

const BANCAS = {
  rio: ["09:20","11:20","14:20","16:20","18:20","21:20"],
  nacional: ["10:00","12:00","15:00","17:00","19:00","21:00"],
  look: ["09:00","11:00","14:00","16:00","18:00","20:00"],
  federal: ["19:00"]
};

//////////////////////////////////////////////////
// 📅 DATA
//////////////////////////////////////////////////

function hoje(){
  return new Date().toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🧹 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista, banca){

  if(!Array.isArray(lista)) return [];

  return lista.map(item => ({
    banca: banca || "rio",
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
// 🌐 FONTE PRINCIPAL
//////////////////////////////////////////////////

async function fonte1(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://app.centraldobichobrasil.com/api/results",
      { timeout: 8000 }
    );
    return normalizar(data,"rio");
  }catch{
    console.log("❌ fonte1 falhou");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 BACKUP
//////////////////////////////////////////////////

async function fonte2(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados",
      { timeout: 8000 }
    );
    return normalizar(data.rio || [],"rio");
  }catch{
    console.log("❌ fonte2 falhou");
    return [];
  }
}

//////////////////////////////////////////////////
// 🧠 APLICAR BANCA + HORÁRIO
//////////////////////////////////////////////////

function aplicarBancaHorario(lista){

  let contador = {
    rio:0, nacional:0, look:0, federal:0
  };

  return lista.map(item=>{

    let banca = item.banca || "rio";

    if(!BANCAS[banca]) banca = "rio";

    const horarios = BANCAS[banca];

    const horario = item.horario || horarios[contador[banca] % horarios.length];

    contador[banca]++;

    return {
      ...item,
      banca,
      horario
    };
  });
}

//////////////////////////////////////////////////
// 🔁 REMOVER DUPLICADOS
//////////////////////////////////////////////////

function removerDuplicados(lista){

  const mapa = {};

  lista.forEach(item=>{
    const chave = item.data + "-" + item.banca + "-" + item.horario;

    if(!mapa[chave]){
      mapa[chave] = item;
    }
  });

  return Object.values(mapa);
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

function salvar(novos){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  let todos = [...novos, ...antigos];

  todos = aplicarBancaHorario(todos);
  todos = removerDuplicados(todos);

  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  todos = todos.filter(d =>
    new Date(d.data) >= limite
  );

  fs.writeFileSync(DB, JSON.stringify(todos,null,2));
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
// 🏦 SEPARAR
//////////////////////////////////////////////////

function separar(lista){
  return {
    rio: lista.filter(x=>x.banca==="rio"),
    nacional: lista.filter(x=>x.banca==="nacional"),
    look: lista.filter(x=>x.banca==="look"),
    federal: lista.filter(x=>x.banca==="federal")
  };
}

//////////////////////////////////////////////////
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  try{

    let dados = await fonte1();

    if(!dados.length){
      dados = await fonte2();
    }

    if(dados.length){
      salvar(dados);
    }

    let banco = [];

    try{
      banco = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const separados = separar(banco);

    const analise = analisar(banco);
    const palpite = gerarPalpite(analise);

    res.json({
      fonte: "banca-real",
      total: banco.length,
      ...separados,
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