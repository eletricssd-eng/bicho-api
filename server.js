import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "segredo123";
const MONGO_URL = process.env.MONGO_URL;

//////////////////////////////////////////////////
// 🟢 MONGODB
//////////////////////////////////////////////////
if(!MONGO_URL){
  console.log("❌ MONGO_URL NÃO DEFINIDA");
}else{
  mongoose.connect(MONGO_URL)
    .then(()=> {
      console.log("✅ Mongo conectado");
      criarAdminPadrao();
    })
    .catch(err=> console.log("❌ erro mongo:", err));
}

//////////////////////////////////////////////////
// 📦 MODELS
//////////////////////////////////////////////////
const ResultadoSchema = new mongoose.Schema({
  data: String,
  banca: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String
});

const Resultado = mongoose.model("Resultado", ResultadoSchema);

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, default: "user" }
});

const User = mongoose.model("User", UserSchema);

//////////////////////////////////////////////////
// 👤 CRIAR ADMIN PADRÃO
//////////////////////////////////////////////////
async function criarAdminPadrao(){

  const existe = await User.findOne({ username: "admin" });

  if(!existe){

    const hash = await bcrypt.hash("1234", 10);

    await User.create({
      username: "admin",
      password: hash,
      role: "admin"
    });

    console.log("✅ Admin criado: admin / 1234");
  }
}

//////////////////////////////////////////////////
// 🔐 LOGIN
//////////////////////////////////////////////////
app.post("/login", async (req,res)=>{

  const { username, password } = req.body;

  const user = await User.findOne({ username });

  if(!user){
    return res.status(401).json({ erro: "Usuário não encontrado" });
  }

  const ok = await bcrypt.compare(password, user.password);

  if(!ok){
    return res.status(401).json({ erro: "Senha inválida" });
  }

  const token = jwt.sign({
    id: user._id,
    role: user.role
  }, SECRET, { expiresIn: "7d" });

  res.json({ token });
});

//////////////////////////////////////////////////
// 🔐 MIDDLEWARE
//////////////////////////////////////////////////
function auth(req,res,next){

  let token = req.headers.authorization;

  if(!token){
    return res.status(401).json({ erro: "Sem token" });
  }

  // 🔥 remove "Bearer "
  if(token.startsWith("Bearer ")){
    token = token.slice(7);
  }

  try{
    jwt.verify(token, SECRET);
    next();
  }catch{
    return res.status(401).json({ erro: "Token inválido" });
  }
}

function adminOnly(req,res,next){

  const token = req.headers.authorization;

  try{
    const decoded = jwt.verify(token, SECRET);

    if(decoded.role !== "admin"){
      return res.status(403).json({ erro: "Apenas admin" });
    }

    next();

  }catch{
    res.status(401).json({ erro: "Token inválido" });
  }
}

//////////////////////////////////////////////////
// 👤 ADMIN ROTAS
//////////////////////////////////////////////////
app.post("/admin/criar-usuario", auth, adminOnly, async (req,res)=>{

  const { username, password, role } = req.body;

  if(!username || !password){
    return res.status(400).json({ erro: "Dados obrigatórios" });
  }

  const existe = await User.findOne({ username });

  if(existe){
    return res.status(400).json({ erro: "Usuário já existe" });
  }

  const hash = await bcrypt.hash(password, 10);

  await User.create({
    username,
    password: hash,
    role: role || "user"
  });

  res.json({ ok: true });
});

app.get("/admin/usuarios", auth, adminOnly, async (req,res)=>{

  const users = await User.find().select("-password");

  res.json(users);
});

app.delete("/admin/usuario/:id", auth, adminOnly, async (req,res)=>{

  await User.findByIdAndDelete(req.params.id);

  res.json({ ok: true });
});

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////
async function scraper(url){

  try{
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela)=>{

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if(!titulo) titulo = "Horário " + (i+1);

      const nums = [];

      $(tabela).find("tr").each((i,tr)=>{
        const match = $(tr).text().match(/\d{4}/);
        if(match) nums.push(match[0]);
      });

      const t = titulo.toLowerCase();

      if(t.includes("federal") && t.includes("10")) return;

      if(nums.length >= 5){

        lista.push({
          horario: titulo.replace(/1 ao 10|1 ao 5|resultado do dia/gi,"").trim(),
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });

      }

    });

    return lista;

  }catch{
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 BANCAS
//////////////////////////////////////////////////
async function pegarTudo(){

  const rio = await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje");
  const look = await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje");
  const nacional = await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje");
  const federal = await scraper("https://www.resultadofacil.com.br/resultado-banca-federal");

  return { rio, look, nacional, federal };
}

//////////////////////////////////////////////////
// 💾 SALVAR MONGO
//////////////////////////////////////////////////
async function salvarMongo(dados){

  const hoje = new Date().toISOString().split("T")[0];

  for(const banca in dados){

    for(const item of dados[banca]){

      await Resultado.updateOne(
        { data: hoje, banca, horario: item.horario },
        { ...item, data: hoje, banca },
        { upsert: true }
      );

    }

  }
}

//////////////////////////////////////////////////
// 📦 CARREGAR MONGO
//////////////////////////////////////////////////
async function carregarMongo(){

  const registros = await Resultado.find().lean();

  const historico = {};

  registros.forEach(r=>{

    if(!historico[r.data]){
      historico[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    historico[r.data][r.banca].push({
      horario: r.horario,
      p1: r.p1,
      p2: r.p2,
      p3: r.p3,
      p4: r.p4,
      p5: r.p5
    });

  });

  return historico;
}

//////////////////////////////////////////////////
// 🚀 CACHE
//////////////////////////////////////////////////
let cache = null;
let tempo = 0;

async function atualizar(){

  const agora = Date.now();

  if(cache && agora - tempo < 60000){
    return cache;
  }

  console.log("🔄 Atualizando...");

  const dados = await pegarTudo();

  await salvarMongo(dados);

  const historico = await carregarMongo();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTA PRINCIPAL
//////////////////////////////////////////////////
app.get("/resultados", auth, async (req,res)=>{
  const dados = await atualizar();
  res.json(dados);
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////
app.listen(PORT, ()=>{
  console.log("🚀 API rodando na porta", PORT);
});