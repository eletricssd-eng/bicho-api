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
      "https://api.allorigins.win/raw?url=https://www.ojogodobicho.com/resultadosanteriores.htm",
      { timeout: 10000 }
    );

    const $ = cheerio.load(data);

    let resultados = [];

    $("table tr").each((i,el)=>{

      const col = $(el).find("td");

      if(col.length >= 6){

        const dataTxt = $(col[0]).text().trim();

        const grupo = {
          banca: "rio",
          data: dataTxt,
          horario: "",
          resultados: []
        };

        // 1º ao 5º
        for(let i=2;i<=6;i++){
          const numero = $(col[i]).text().trim();

          if(/\d{4}/.test(numero)){
            grupo.resultados.push({
              pos: i-1,
              numero
            });
          }
        }

        if(grupo.resultados.length){
          resultados.push(grupo);
        }
      }

    });

    // 🔥 pega só últimos 6 dias
    return resultados.slice(0,6);

  }catch(e){
    console.log("ERRO HISTÓRICO:", e.message);
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