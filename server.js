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

//////////////////////////////////////////////////
// 🧠 HORÁRIOS
//////////////////////////////////////////////////

const HORARIOS = ["09:00","11:00","14:00","16:00","18:00","21:00"];

//////////////////////////////////////////////////
// 🌐 FONTE 1 (resultadofacil)
//////////////////////////////////////////////////

async function fonte1(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://resultadofacil.com.br/resultado-do-jogo-do-bicho/"
    );

    const $ = cheerio.load(data);
    let lista = [];

    $("table tr").each((i,el)=>{
      const col = $(el).find("td");

      if(col.length >= 2){
        const pos = $(col[0]).text().trim();
        const numero = $(col[1]).text().trim();

        if(/\d{4}/.test(numero)){
          lista.push({ pos, numero });
        }
      }
    });

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 2 (paratodos)
//////////////////////////////////////////////////

async function fonte2(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://paratodosbrasil.vip"
    );

    const $ = cheerio.load(data);
    let lista = [];

    $("li,div").each((i,el)=>{
      const texto = $(el).text();
      const match = texto.match(/(\d{1,2})\D+(\d{4})/);

      if(match){
        lista.push({ pos: match[1], numero: match[2] });
      }
    });

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 3 (look/goias estilo)
//////////////////////////////////////////////////

async function fonte3(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.resultadosdobicho.com/"
    );

    const $ = cheerio.load(data);
    let lista = [];

    $("li").each((i,el)=>{
      const texto = $(el).text();
      const match = texto.match(/(\d{1,2})\D+(\d{4})/);

      if(match){
        lista.push({ pos: match[1], numero: match[2] });
      }
    });

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 4 (backup API)
//////////////////////////////////////////////////

async function fonte4(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados"
    );

    let lista = [];

    (data.rio || []).forEach(item=>{
      item.resultados.forEach(r=>{
        lista.push({
          pos: r.pos,
          numero: r.numero
        });
      });
    });

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🧠 VALIDAÇÃO INTELIGENTE
//////////////////////////////////////////////////

function validar(...fontes){

  const mapa = {};

  fontes.flat().forEach(r=>{
    const chave = `${r.pos}-${r.numero}`;
    mapa[chave] = (mapa[chave] || 0) + 1;
  });

  const ordenado = Object.entries(mapa)
    .sort((a,b)=>b[1]-a[1]);

  return ordenado.slice(0,5).map(([k])=>{
    const [pos,numero] = k.split("-");
    return {
      pos: parseInt(pos),
      numero
    };
  });
}

//////////////////////////////////////////////////
// 🚀 COLETAR REAL
//////////////////////////////////////////////////

async function coletar(){

  const [f1,f2,f3,f4] = await Promise.all([
    fonte1(),
    fonte2(),
    fonte3(),
    fonte4()
  ]);

  console.log("F1:",f1.length,"F2:",f2.length,"F3:",f3.length,"F4:",f4.length);

  const validos = validar(f1,f2,f3,f4);

  if(validos.length === 0) return [];

  return [{
    banca: "rio",
    horario: "18:00",
    data: new Date().toISOString().split("T")[0],
    resultados: validos
  }];
}

//////////////////////////////////////////////////
// 💾 HISTÓRICO 7 DIAS
//////////////////////////////////////////////////

function salvar(dados){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const todos = [...antigos, ...dados];

  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  const filtrado = todos.filter(d => new Date(d.data) >= limite);

  fs.writeFileSync(DB, JSON.stringify(filtrado,null,2));
}

//////////////////////////////////////////////////
// 📊 ANALISE REAL
//////////////////////////////////////////////////

function analisar(dados){

  let contagem = {};

  dados.forEach(d=>{
    d.resultados.forEach(r=>{
      const dez = r.numero.slice(-2);
      contagem[dez] = (contagem[dez] || 0) + 1;
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
// 🎯 PALPITE FORTE
//////////////////////////////////////////////////

function palpite(analise){

  if(!analise.mais_fortes.length){
    return ["00","11","22"];
  }

  return analise.mais_fortes
    .slice(0,3)
    .map(x=>x[0]);
}

//////////////////////////////////////////////////
// 🌐 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  const novos = await coletar();

  if(novos.length){
    salvar(novos);
  }

  let dados = [];

  try{
    dados = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const analise = analisar(dados);

  res.json({
    fonte: "multi-real",
    atualizados: novos.length,
    total: dados.length,
    rio: dados,
    analise,
    palpite: palpite(analise)
  });

});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT,"0.0.0.0",()=>{
  console.log("🚀 SISTEMA BANCA ONLINE");
});