import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🧠 ORDEM HORÁRIOS
//////////////////////////////////////////////////

const ORDEM = ["09","10","11","12","14","15","16","18","19","21"];

function ordenar(lista){
  return lista.sort((a,b)=>{
    return ORDEM.indexOf(a.horario?.slice(0,2)) -
           ORDEM.indexOf(b.horario?.slice(0,2));
  });
}

//////////////////////////////////////////////////
// 🔄 NORMALIZAR
//////////////////////////////////////////////////

function normalizar(lista){
  if(!Array.isArray(lista)) return [];

  return lista.map(item=>({
    banca: item.banca || item.bank || "rio",
    horario: item.horario || item.time || "",
    resultados: (item.resultados || item.results || []).map(r=>({
      pos: parseInt(r.pos || r.position),
      numero: String(r.numero || r.number),
      bicho: r.bicho || r.animal || ""
    }))
  }));
}

//////////////////////////////////////////////////
// 🌐 CENTRAL DO BICHO (PUPPETEER)
//////////////////////////////////////////////////

async function pegarCentral(){
  let browser;

  try{
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage();

    await page.goto("https://app.centraldobichobrasil.com/resultados", {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const dados = await page.evaluate(()=>{
      const lista = [];

      document.querySelectorAll("*").forEach(el=>{
        const texto = el.innerText || "";

        const match = texto.match(/(\d{1,2})º\s*(\d{4})/);

        if(match){
          lista.push({
            banca: "rio",
            horario: "",
            resultados:[{
              pos: match[1],
              numero: match[2],
              bicho:""
            }]
          });
        }
      });

      return lista;
    });

    await browser.close();

    return normalizar(dados);

  }catch(e){
    if(browser) await browser.close();
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 PARATODOS (SCRAPING)
//////////////////////////////////////////////////

async function pegarParatodos(){
  try{
    const { data } = await axios.get(
      "https://api.allorigins.win/raw?url=https://paratodosbrasil.vip"
    );

    const $ = cheerio.load(data);

    let lista = [];

    $("li, div").each((i,el)=>{
      const texto = $(el).text();

      const match = texto.match(/(\d{1,2})º.*?(\d{4})/);

      if(match){
        lista.push({
          banca:"rio",
          horario:"",
          resultados:[{
            pos: match[1],
            numero: match[2],
            bicho:""
          }]
        });
      }
    });

    return normalizar(lista);

  }catch(e){
    return [];
  }
}

//////////////////////////////////////////////////
// 🌐 API BACKUP
//////////////////////////////////////////////////

async function pegarAPI(){
  try{
    const { data } = await axios.get(
      "https://bicho-api.onrender.com/resultados"
    );

    return normalizar(data.rio || []);

  }catch(e){
    return [];
  }
}

//////////////////////////////////////////////////
// 🧠 UNIFICAR + LIMPAR
//////////////////////////////////////////////////

function unificar(fontes){
  const mapa = {};

  fontes.flat().forEach(item=>{
    item.resultados.forEach(r=>{

      const chave = `${item.horario}-${r.pos}`;

      if(!mapa[chave]){
        mapa[chave] = {
          banca: item.banca,
          horario: item.horario,
          resultados:[]
        };
      }

      const existe = mapa[chave].resultados.find(x=>x.numero === r.numero);

      if(!existe){
        mapa[chave].resultados.push(r);
      }

    });
  });

  return Object.values(mapa);
}

//////////////////////////////////////////////////
// 🧠 CONFIANÇA
//////////////////////////////////////////////////

function confianca(qtd){
  if(qtd >= 3) return "alta";
  if(qtd === 2) return "media";
  return "baixa";
}

//////////////////////////////////////////////////
// 🚀 CORE
//////////////////////////////////////////////////

async function pegarResultados(){
  let fontes = [];
  let usadas = 0;

  const central = await pegarCentral();
  if(central.length){
    fontes.push(central);
    usadas++;
  }

  const para = await pegarParatodos();
  if(para.length){
    fontes.push(para);
    usadas++;
  }

  const api = await pegarAPI();
  if(api.length){
    fontes.push(api);
    usadas++;
  }

  if(fontes.length === 0){
    return { fonte:"mock", confianca:"zero", dados:[] };
  }

  return {
    fonte:"multi",
    confianca: confianca(usadas),
    dados: unificar(fontes)
  };
}

//////////////////////////////////////////////////
// 📊 SEPARAR
//////////////////////////////////////////////////

function separar(dados){
  return {
    rio: ordenar(dados),
    nacional: ordenar(dados),
    look: ordenar(dados),
    federal: ordenar(dados)
  };
}

//////////////////////////////////////////////////
// 🌐 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req,res)=>{
  try{

    const r = await pegarResultados();
    const dados = separar(r.dados);

    res.json({
      fonte: r.fonte,
      confianca: r.confianca,
      ...dados
    });

  }catch(e){
    res.status(500).json({ erro:"falha geral" });
  }
});

//////////////////////////////////////////////////
// TESTE
//////////////////////////////////////////////////

app.get("/", (req,res)=>{
  res.send("API ONLINE 🚀");
});

//////////////////////////////////////////////////
// START
//////////////////////////////////////////////////

app.listen(PORT, "0.0.0.0", ()=>{
  console.log("🚀 rodando na porta", PORT);
});