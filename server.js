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
// 🔥 MONGO
//////////////////////////////////////////////////

const MONGO_URL = process.env.MONGO_URL;

async function conectarMongo() {
  try {
    await mongoose.connect(MONGO_URL, {
      serverSelectionTimeoutMS: 5000
    });
    console.log("✅ Mongo conectado");
  } catch (e) {
    console.log("❌ erro mongo:", e.message);
    setTimeout(conectarMongo, 5000);
  }
}

conectarMongo();

//////////////////////////////////////////////////
// 👤 USER MODEL (NOVO)
//////////////////////////////////////////////////

const UsuarioSchema = new mongoose.Schema({
  usuario: { type: String, unique: true },
  senha: String
});

const Usuario = mongoose.model("Usuario", UsuarioSchema);

//////////////////////////////////////////////////
// 🔐 AUTH MIDDLEWARE (NOVO)
//////////////////////////////////////////////////

function auth(req, res, next){

  const token = req.headers.authorization;

  if(!token){
    return res.status(401).json({ erro: "Sem token" });
  }

  try{
    const decoded = jwt.verify(token, SECRET);
    req.userId = decoded.id;
    next();
  }catch{
    return res.status(401).json({ erro: "Token inválido" });
  }
}

//////////////////////////////////////////////////
// 📝 CADASTRO (NOVO)
//////////////////////////////////////////////////

app.post("/cadastro", async (req, res) => {

  try{

    const { usuario, senha } = req.body;

    if(!usuario || !senha){
      return res.status(400).json({ erro: "Preencha tudo" });
    }

    const existe = await Usuario.findOne({ usuario });

    if(existe){
      return res.status(400).json({ erro: "Usuário já existe" });
    }

    const hash = await bcrypt.hash(senha, 10);

    await Usuario.create({ usuario, senha: hash });

    res.json({ ok: true });

  }catch(e){
    res.status(500).json({ erro: "Erro no cadastro" });
  }
});

//////////////////////////////////////////////////
// 🔑 LOGIN (NOVO)
//////////////////////////////////////////////////

app.post("/login", async (req, res) => {

  try{

    const { usuario, senha } = req.body;

    const user = await Usuario.findOne({ usuario });

    if(!user){
      return res.status(400).json({ erro: "Usuário não existe" });
    }

    const ok = await bcrypt.compare(senha, user.senha);

    if(!ok){
      return res.status(400).json({ erro: "Senha inválida" });
    }

    const token = jwt.sign({ id: user._id }, SECRET, {
      expiresIn: "7d"
    });

    res.json({ token });

  }catch(e){
    res.status(500).json({ erro: "Erro no login" });
  }
});

//////////////////////////////////////////////////
// 📦 MODEL RESULTADO (SEU ORIGINAL)
//////////////////////////////////////////////////

const ResultadoSchema = new mongoose.Schema({
  uniqueId: { type: String, unique: true },
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

//////////////////////////////////////////////////
// 🧠 VALIDAÇÃO FORTE (SEU)
//////////////////////////////////////////////////

function resultadoValido(r) {
  const invalidos = [
    "0000","1111","2222","3333","4444",
    "5555","6666","7777","8888","9999","2026"
  ];

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  if (lista.some(n => invalidos.includes(n))) return false;
  if (r.horario.toLowerCase().includes("extra")) return false;

  return true;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (SEU)
//////////////////////////////////////////////////

async function scraper(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "pt-BR"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if (!titulo) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\d{4}/g);
        if (match) match.forEach(n => nums.push(n));
      });

      if (nums.length >= 5) {
        lista.push({
          horario: titulo,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        });
      }
    });

    return lista;

  } catch (e) {
    console.log("❌ erro scraper:", url, e.message);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 BANCAS (SEU)
//////////////////////////////////////////////////

async function pegarTudo() {

  const [rio, look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  ]);

  return {
    rio,
    look,
    nacional,
    federal: federal.length ? [federal[0]] : []
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR (SEU)
//////////////////////////////////////////////////

async function salvarMongo(dados) {

  if (mongoose.connection.readyState !== 1) {
    console.log("⚠️ Mongo offline");
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];

  for (const banca in dados) {
    for (const item of dados[banca]) {

      if (!resultadoValido(item)) continue;

      try {
        const uniqueId = `${hoje}-${banca}-${item.horario}`;

        await Resultado.findOneAndUpdate(
          { uniqueId },
          { ...item, data: hoje, banca, uniqueId },
          { upsert: true }
        );

      } catch (e) {
        console.log("❌ erro salvar:", e.message);
      }
    }
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO (SEU)
//////////////////////////////////////////////////

async function pegarHistorico() {

  const dados = await Resultado.find().lean();
  const historico = {};

  dados.forEach(r => {

    if (!historico[r.data]) {
      historico[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    historico[r.data][r.banca].push(r);
  });

  return historico;
}

//////////////////////////////////////////////////
// 🚀 CACHE (SEU)
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo() {

  const agora = Date.now();

  if (cache && (agora - tempo < 60000)) {
    return cache;
  }

  const dados = await pegarTudo();
  await salvarMongo(dados);

  const historico = await pegarHistorico();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 ROTAS
//////////////////////////////////////////////////

app.get("/", (req, res) => {
  res.send("✅ API ONLINE");
});

// 🔒 AGORA PROTEGIDA
app.get("/resultados", auth, async (req, res) => {
  try {
    const dados = await carregarTudo();
    res.json(dados);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});