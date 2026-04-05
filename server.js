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

    let lista = [];

    $("table tr").each((i,el)=>{
      const col = $(el).find("td");

      if(col.length >= 2){
        const pos = $(col[0]).text().trim();
        const numero = $(col[1]).text().trim();

        if(/\d{4}/.test(numero)){
          lista.push({
            pos: parseInt(pos),
            numero
          });
        }
      }
    });

    return lista.slice(0,5);

  }catch(e){
    console.log("ERRO FONTE:", e.message);
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
      fonte: "segura",
      total: dados.length,
      resultados: dados
    });

  }catch(e){
    console.log("ERRO ROTA:", e.message);

    res.json({
      erro: "falha controlada"
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