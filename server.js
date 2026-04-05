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
// 🧠 HORÁRIOS REAIS
//////////////////////////////////////////////////

const HORARIOS = ["09:00","11:00","14:00","16:00","18:00","21:00"];

//////////////////////////////////////////////////
// 🌐 FONTE 1
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

        if(numero.match(/\d{4}/)){
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
// 🌐 FONTE 2
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
      const match = texto.match(/(\d{1,2})º.*?(\d{4})/);

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
// 🧠 VALIDAÇÃO (CORE)
//////////////////////////////////////////////////

function validar(f1,f2){

  const mapa = {};

  f1.forEach(r=>{
    const chave = `${r.pos}-${r.numero}`;
    mapa[chave] = (mapa[chave] || 0) + 1;
  });

  f2.forEach(r=>{
    const chave = `${r.pos}-${r.numero}`;
    mapa[chave] = (mapa[chave] || 0) + 1;
  });

  return Object.entries(mapa)
    .filter(([k,v]) => v >= 2)
    .map(([k])=>{
      const [pos,numero] = k.split("-");
      return { pos: parseInt(pos), numero };
    });
}

//////////////////////////////////////////////////
// 🚀 COLETAR REAL
//////////////////////////////////////////////////

async function coletar(){

  const f1 = await fonte1();
  const f2 = await fonte2();

  const validos = validar(f1,f2);

  if(validos.length === 0) return [];

  return [{
    banca: "rio",
    horario: "18:00",
    data: new Date().toISOString().split("T")[0],
    resultados: validos.slice(0,5)
  }];
}

//////////////////////////////////////////////////
// 💾 SALVAR HISTÓRICO
//////////////////////////////////////////////////

function salvar(dados){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const final = [...antigos, ...dados];

  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  const filtrado = final.filter(d => new Date(d.data) >= limite);

  fs.writeFileSync(DB, JSON.stringify(filtrado,null,2));
}

//////////////////////////////////////////////////
// 📊 ANALISAR
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
    fortes: ordenado.slice(0,10),
    fracos: ordenado.slice(-10)
  };
}

//////////////////////////////////////////////////
// 🎯 PALPITE FORTE
//////////////////////////////////////////////////

function palpiteForte(analise){

  if(!analise.fortes.length){
    return ["00","11","22"];
  }

  return analise.fortes
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
    fonte: "banca",
    total: dados.length,
    rio: dados,
    analise,
    palpite: palpiteForte(analise)
  });

});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT,"0.0.0.0",()=>{
  console.log("🚀 BANCA ONLINE");
});