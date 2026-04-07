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
// 🧠 DETECTAR DATA REAL
//////////////////////////////////////////////////

function extrairData(item){
  return item.date || item.data || item.created_at?.slice(0,10) || hoje();
}

//////////////////////////////////////////////////
// 🧹 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista){

  if(!Array.isArray(lista)) return [];

  return lista.map(item => ({

    banca: item.banca || item.bank || "",

    data: extrairData(item),

    horario: item.time || item.horario || "",

    resultados: (item.results || item.resultados || []).map((r,i)=>({

      pos: Number(r.pos || r.position || i+1),

      numero: String(r.number || r.numero || "0000")
        .replace(/\D/g,"")
        .padStart(4,"0"),

      dezena: String(r.number || r.numero || "0000")
        .replace(/\D/g,"")
        .slice(-2)
    }))

  }));
}

//////////////////////////////////////////////////
// 🌐 MULTI FONTES REAIS
//////////////////////////////////////////////////

async function pegarDados(){

  let lista = [];

  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://app.centraldobichobrasil.com/api/results",
      { timeout: 8000 }
    );

    lista.push(...normalizar(data));

  }catch{
    console.log("❌ central falhou");
  }

  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados",
      { timeout: 8000 }
    );

    lista.push(...normalizar(data.rio || []));

  }catch{
    console.log("❌ backup falhou");
  }

  return lista;
}

//////////////////////////////////////////////////
// 🧠 DETECTAR BANCA POR HORÁRIO
//////////////////////////////////////////////////

function detectarBancaPorHorario(horario){

  if(!horario) return "rio";

  for(const banca in BANCAS){
    if(BANCAS[banca].includes(horario)){
      return banca;
    }
  }

  return "rio";
}

//////////////////////////////////////////////////
// 🧠 ORGANIZAR DADOS CORRETAMENTE
//////////////////////////////////////////////////

function organizar(lista){

  let contadores = {
    rio:0, nacional:0, look:0, federal:0
  };

  return lista.map(item=>{

    let banca = item.banca;

    // se não veio banca → detectar
    if(!banca){
      banca = detectarBancaPorHorario(item.horario);
    }

    if(!BANCAS[banca]) banca = "rio";

    let horario = item.horario;

    // se não veio horário → gerar sequencial REAL
    if(!horario){
      const horarios = BANCAS[banca];
      horario = horarios[contadores[banca] % horarios.length];
      contadores[banca]++;
    }

    return {
      ...item,
      banca,
      horario
    };
  });
}

//////////////////////////////////////////////////
// 🔁 REMOVER DUPLICADOS (CORRIGIDO)
//////////////////////////////////////////////////

function removerDuplicados(lista){

  const mapa = {};

  lista.forEach(item=>{

    const chave =
      item.data +
      "-" +
      item.banca +
      "-" +
      item.horario +
      "-" +
      item.resultados.map(r=>r.numero).join("");

    mapa[chave] = item;
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

  todos = organizar(todos);
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

    const dados = await pegarDados();

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
      fonte: "real-banca-corrigido",
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