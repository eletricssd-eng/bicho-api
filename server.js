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
      "https://api.allorigins.win/raw?url=https://www.resultadofacil.com.br/",
      { timeout: 10000 }
    );

    const $ = cheerio.load(data);

    let lista = [];

    $("td").each((i,el)=>{
      const texto = $(el).text().trim();

      if(/\d{4}/.test(texto)){
        lista.push(texto);
      }
    });

    // agrupa 5 resultados
    let resultado = [];

    for(let i=0;i<lista.length;i+=5){
      resultado.push({
        banca: "rio",
        horario: ["09:00","11:00","14:00","16:00","18:00","21:00"][i/5] || "00:00",
        resultados: lista.slice(i,i+5).map((n,j)=>({
          pos: j+1,
          numero: n
        }))
      });
    }

    return resultado;

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