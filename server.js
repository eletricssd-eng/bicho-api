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
// 🧹 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista){
  return lista.map(item => ({
    banca: "rio",
    data: item.data || new Date().toISOString().split("T")[0],
    horario: item.horario || "",
    resultados: item.resultados.map(r => ({
      pos: Number(r.pos),
      numero: String(r.numero).padStart(4,"0"),
      grupo: r.grupo || "",
      dezena: String(r.numero).slice(-2)
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 FONTE 1 (SITE HTML)
//////////////////////////////////////////////////

async function fonte1(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://www.ojogodobicho.com/resultadosanteriores.htm"
    );

    const $ = cheerio.load(data);
    let lista = [];
    let index = 0;

    $("table tr").each((i,el)=>{
      const col = $(el).find("td");

      if(col.length >= 5){

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

        if(resultados.length){
          lista.push({
            horario: HORARIOS[index % 6],
            resultados
          });
          index++;
        }
      }
    });

    return normalizar(lista);

  }catch(e){
    console.log("❌ fonte1 erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 2 (API SUA)
//////////////////////////////////////////////////

async function fonte2(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados"
    );

    return normalizar(data.rio || []);

  }catch(e){
    console.log("❌ fonte2 erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 FONTE 3 (SCRAPING EXTRA)
//////////////////////////////////////////////////

async function fonte3(){
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
            horario: "",
            resultados: [{
              pos: 1,
              numero
            }]
          });
        }
      }
    });

    return normalizar(lista);

  }catch(e){
    console.log("❌ fonte3 erro");
    return [];
  }
}

//////////////////////////////////////////////////
// 🧠 UNIFICAR (REMOVE DUPLICADOS)
//////////////////////////////////////////////////

function unificar(fontes){

  const mapa = {};

  fontes.flat().forEach(item=>{

    const chave = item.horario + JSON.stringify(item.resultados);

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

  const lista = analise.por_horario[alvo] || [];

  if(!lista.length) return ["00","11","22"];

  return lista.slice(0,3).map(x=>x[0]);
}

//////////////////////////////////////////////////
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  try{

    const f1 = await fonte1();
    const f2 = await fonte2();
    const f3 = await fonte3();

    const dados = unificar([f1,f2,f3]);

    if(dados.length){
      salvar(dados);
    }

    let banco = [];

    try{
      banco = JSON.parse(fs.readFileSync(DB));
    }catch{}

    const analise = analisar(banco);
    const palpite = gerarPalpite(analise);

    res.json({
      fonte: "multi-real",
      total: banco.length,
      rio: banco,
      nacional: [],
      look: [],
      federal: [],
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
// TESTE
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("API MULTI FONTE 🔥");
});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando na porta", PORT);
});
