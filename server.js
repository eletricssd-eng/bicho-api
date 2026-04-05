import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔥 CORREÇÃO DO __dirname
const __dirname = new URL('.', import.meta.url).pathname;

// 🔥 GARANTE ARQUIVO
const DB = path.join(__dirname, "dados.json");

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]");
}

//////////////////////////////////////////////////
// 🌐 FONTE SIMPLES (SEGURA)
//////////////////////////////////////////////////

async function pegarDados(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://resultadofacil.com.br/resultado-do-jogo-do-bicho/",
      { timeout: 10000 }
    );

    const $ = cheerio.load(data);

    let resultados = [];

    $("table").each((i,tabela)=>{

      let grupo = {
        banca: "rio",
        horario: ["09:00","11:00","14:00","16:00","18:00","21:00"][i] || "00:00",
        resultados: []
      };

      $(tabela).find("tr").each((i,el)=>{
        const col = $(el).find("td");

        if(col.length >= 2){

          const pos = parseInt($(col[0]).text().trim());
          const numero = $(col[1]).text().trim();

          if(/\d{4}/.test(numero)){
            grupo.resultados.push({
              pos,
              numero
            });
          }
        }
      });

      if(grupo.resultados.length){
        grupo.resultados = grupo.resultados.slice(0,5);
        resultados.push(grupo);
      }

    });

    return resultados;

  }catch(e){
    console.log("ERRO:", e.message);
    return [];
  }
}
//////////////////////////////////////////////////
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{
  try{

    const dados = await pegarDados();

    res.json({
      fonte: "real",
      rio: dados,
      nacional: [],
      look: [],
      federal: []
    });

  }catch(e){
    res.json({
      fonte: "erro",
      rio: []
    });
  }
});
//////////////////////////////////////////////////
// TESTE
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("API ONLINE 🚀");
});

//////////////////////////////////////////////////
// START (OBRIGATÓRIO RENDER)
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando porta", PORT);
});