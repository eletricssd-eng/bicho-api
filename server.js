import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "segredo";

//////////////////////////////////////////////////
// 🔗 MONGO
//////////////////////////////////////////////////

if (!process.env.MONGO_URI) {
  console.log("❌ MONGO_URI não definida");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo conectado"))
  .catch(err => {
    console.log("❌ erro Mongo:", err.message);
    process.exit(1);
  });

//////////////////////////////////////////////////
// 📦 MODELS
//////////////////////////////////////////////////

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true },
  data: String,
  banca: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String
}));

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}));

//////////////////////////////////////////////////
// 🔐 AUTH (ACEITA BEARER)
//////////////////////////////////////////////////

function auth(req, res, next){

  let token = req.headers.authorization;

  if(!token){
    return res.status(401).json({ erro: "Sem token" });
  }

  // 🔥 suporta "Bearer TOKEN"
  if(token.startsWith("Bearer ")){
    token = token.split(" ")[1];
  }

  try{
    jwt.verify(token, SECRET);
    next();
  }catch{
    return res.status(403).json({ erro: "Token inválido" });
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (ANTI DUPLICAÇÃO + FEDERAL FIX)
//////////////////////////////////////////////////

async function scraper(url){

  try{

    const { data } = await axios.get(url,{
      headers:{ "User-Agent":"Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];
    const jaVistos = new Set();

    $("table").each((i, tabela)=>{

      let titulo = $(tabela)
        .prevAll("h2, h3, strong")
        .first()
        .text()
        .trim();

      if(!titulo) titulo = "Horário "+(i+1);

      const tituloLower = titulo.toLowerCase();

      // 🔥 FEDERAL SOMENTE 1 AO 5
      if(tituloLower.includes("federal")){
        if(!/1\s*(º|°)?\s*ao\s*5/.test(tituloLower)){
          return;
        }
      }

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/);
        if(match) nums.push(match[0]);
      });

      if(nums.length >= 5){

        const numeros = nums.slice(0,5);

        // 🔥 evita repetição
        const assinatura = numeros.join("-");
        if(jaVistos.has(assinatura)) return;
        jaVistos.add(assinatura);

        lista.push({
          horario: titulo
            .replace(/1\s*(º|°)?\s*ao\s*10/gi,"")
            .replace(/1\s*(º|°)?\s*ao\s*5/gi,"")
            .replace(/resultado do dia/gi,"")
            .trim(),

          p1:numeros[0],
          p2:numeros[1],
          p3:numeros[2],
          p4:numeros[3],
          p5:numeros[4]
        });

      }

    });

    return lista;

  }catch{
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 PEGAR DADOS
//////////////////////////////////////////////////

async function pegarTudo(){

  return {
    rio: await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    look: await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    nacional: await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    federal: await scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR (SEM DUPLICAR)
//////////////////////////////////////////////////

async function salvarBanco(dados){

  const dataHoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const item of dados[banca]){

      const uniqueId =
        `${dataHoje}-${banca}-${item.p1}-${item.p2}-${item.p3}-${item.p4}-${item.p5}`;

      await Resultado.updateOne(
        { uniqueId },
        {
          $set:{
            data:dataHoje,
            banca,
            horario:item.horario,
            p1:item.p1,
            p2:item.p2,
            p3:item.p3,
            p4:item.p4,
            p5:item.p5
          }
        },
        { upsert:true }
      );

    }

  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO LIMPO
//////////////////////////////////////////////////

async function pegarHistorico(){

  const dados = await Resultado.find()
    .sort({ data:-1 })
    .limit(500);

  const agrupado = {};

  dados.forEach(r=>{

    if(!agrupado[r.data]){
      agrupado[r.data] = {
        rio:[], look:[], nacional:[], federal:[]
      };
    }

    const existe = agrupado[r.data][r.banca]
      .some(i => i.p1 === r.p1 && i.horario === r.horario);

    if(!existe){
      agrupado[r.data][r.banca].push({
        horario:r.horario,
        p1:r.p1,
        p2:r.p2,
        p3:r.p3,
        p4:r.p4,
        p5:r.p5
      });
    }

  });

  return agrupado;
}

//////////////////////////////////////////////////
// ⚡ CACHE (DEIXA RÁPIDO)
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo(){

  const agora = Date.now();

  if(cache && (agora - tempo < 60000)){
    return cache;
  }

  const dados = await pegarTudo();

  await salvarBanco(dados);

  const historico = await pegarHistorico();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🔐 LOGIN
//////////////////////////////////////////////////

app.post("/login", async (req,res)=>{

  const { username, password } = req.body;

  const user = await User.findOne({ username });

  if(!user){
    return res.status(400).json({ erro:"Usuário não encontrado" });
  }

  const ok = await bcrypt.compare(password, user.password);

  if(!ok){
    return res.status(400).json({ erro:"Senha inválida" });
  }

  const token = jwt.sign({ id:user._id }, SECRET, { expiresIn:"7d" });

  res.json({ token });
});

//////////////////////////////////////////////////
// 👤 CRIAR USER (USAR UMA VEZ)
//////////////////////////////////////////////////

app.get("/criar-user", async (req,res)=>{

  const hash = await bcrypt.hash("1234",10);

  await User.create({
    username:"admin",
    password:hash
  });

  res.send("Usuário criado");
});

//////////////////////////////////////////////////
// 🚀 ROTA PROTEGIDA
//////////////////////////////////////////////////

app.get("/resultados", auth, async (req,res)=>{

  try{

    const dados = await carregarTudo();

    res.json(dados);

  }catch(err){
    console.log("❌ erro:", err.message);
    res.status(500).json({ erro:"Erro servidor" });
  }

});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, ()=>{
  console.log("🚀 Rodando na porta", PORT);
});