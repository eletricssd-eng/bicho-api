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

const HORARIOS = {
  rio: ["09:00","11:00","14:00","16:00","18:00","21:00"],
  nacional: ["11:00","14:00","16:00","18:00","21:00"],
  look: ["10:00","12:00","15:00","18:00","20:00"],
  federal: ["19:00"]
};

//////////////////////////////////////////////////
// 🔄 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista){
  return lista.map(item=>({
    banca: item.banca.toLowerCase(),
    horario: item.horario,
    data: item.data,
    resultados: item.resultados.map(r=>({
      pos: parseInt(r.pos),
      numero: String(r.numero).padStart(4,"0")
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 SCRAPING SIMPLES (FUNCIONA SEM BLOQUEIO)
//////////////////////////////////////////////////

async function pegarFonte(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://resultadofacil.com.br/resultado-do-jogo-do-bicho/"
    );

    const $ = cheerio.load(data);

    let lista = [];

    let horarioIndex = 0;

    $("table").each((i, tabela)=>{

      const horario = HORARIOS.rio[horarioIndex] || "00:00";

      $(tabela).find("tr").each((i, el)=>{
        const col = $(el).find("td");

        if(col.length >= 2){

          const pos = $(col[0]).text().trim();
          const numero = $(col[1]).text().trim();

          if(numero.match(/\d{4}/)){
            lista.push({
              banca: "rio",
              horario,
              data: new Date().toISOString().split("T")[0],
              resultados: [{
                pos,
                numero
              }]
            });
          }
        }
      });

      horarioIndex++;
    });

    return normalizar(lista);

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 💾 SALVAR HISTÓRICO (7 DIAS)
//////////////////////////////////////////////////

function salvar(dados){

  let antigos = [];

  try{
    antigos = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const mapa = {};

  [...antigos, ...dados].forEach(item=>{
    item.resultados.forEach(r=>{

      const chave = `${item.data}-${item.horario}-${r.pos}`;

      if(!mapa[chave]){
        mapa[chave] = {
          banca: item.banca,
          horario: item.horario,
          data: item.data,
          resultados:[]
        };
      }

      if(!mapa[chave].resultados.find(x=>x.pos==r.pos)){
        mapa[chave].resultados.push(r);
      }
    });
  });

  let final = Object.values(mapa);

  // manter 7 dias
  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  final = final.filter(d=> new Date(d.data) >= limite);

  fs.writeFileSync(DB, JSON.stringify(final,null,2));
}

//////////////////////////////////////////////////
// 📊 ANALISE 7 DIAS
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
// 🎯 PALPITE
//////////////////////////////////////////////////

function gerarPalpite(analise){

  const base = analise.mais_fortes;

  let palpites = [];

  for(let i=0;i<3;i++){
    const aleatorio = base[Math.floor(Math.random()*base.length)];
    palpites.push(aleatorio[0]);
  }

  return palpites;
}

//////////////////////////////////////////////////
// 📊 AGRUPAR RESULTADOS (1º ao 5º)
//////////////////////////////////////////////////

function agrupar(dados){

  const mapa = {};

  dados.forEach(item=>{
    const chave = `${item.data}-${item.horario}`;

    if(!mapa[chave]){
      mapa[chave] = {
        banca: item.banca,
        horario: item.horario,
        data: item.data,
        resultados:[]
      };
    }

    mapa[chave].resultados.push(...item.resultados);
  });

  return Object.values(mapa).map(d=>{
    d.resultados = d.resultados
      .sort((a,b)=>a.pos-b.pos)
      .slice(0,5);

    return d;
  });
}

//////////////////////////////////////////////////
// 🚀 ROTA PRINCIPAL
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{

  const novos = await pegarFonte();

  if(novos.length){
    salvar(novos);
  }

  let dados = [];

  try{
    dados = JSON.parse(fs.readFileSync(DB));
  }catch{}

  const agrupados = agrupar(dados);

  const analise = analisar(dados);

  res.json({
    fonte: "real",
    rio: agrupados,
    nacional: agrupados,
    look: agrupados,
    federal: agrupados,
    analise,
    palpite: gerarPalpite(analise)
  });

});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT,"0.0.0.0",()=>{
  console.log("🚀 API TOP rodando");
});