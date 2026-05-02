import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

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
// 📦 MODEL
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
// 🧠 VALIDAÇÃO FORTE
//////////////////////////////////////////////////

function resultadoValido(r) {
  const invalidos = [
    "0000","1111","2222","3333","4444",
    "5555","6666","7777","8888","9999","2026"
  ];

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // bloqueia qualquer número fake
  if (lista.some(n => invalidos.includes(n))) return false;

  // bloqueia "extração"
  if (r.horario.toLowerCase().includes("extra")) return false;

  return true;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER FORTE (ANTI 403)
//////////////////////////////////////////////////

async function scraper(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
        "Connection": "keep-alive"
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
        if (match) {
          match.forEach(n => nums.push(n));
        }
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
// 🏦 BANCAS
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
// 💾 SALVAR (COM FILTRO)
//////////////////////////////////////////////////

async function salvarMongo(dados) {

  if (mongoose.connection.readyState !== 1) {
    console.log("⚠️ Mongo offline");
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];

  for (const banca in dados) {

    for (const item of dados[banca]) {

      // 🔥 valida antes de salvar
      if (!resultadoValido(item)) {
        console.log("🚫 IGNORADO:", item.horario);
        continue;
      }

      try {
        const uniqueId = `${hoje}-${banca}-${item.horario}`;

        await Resultado.findOneAndUpdate(
          { uniqueId },
          { ...item, data: hoje, banca, uniqueId },
          { upsert: true }
        );

        console.log("✅ SALVO:", uniqueId);

      } catch (e) {
        console.log("❌ erro salvar:", e.message);
      }
    }
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
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
// 🚀 CACHE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo() {

  const agora = Date.now();

  if (cache && (agora - tempo < 60000)) {
    return cache;
  }

  console.log("🔄 ATUALIZANDO...");

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

app.get("/resultados", async (req, res) => {
  try {
    const dados = await carregarTudo();
    res.json(dados);
  } catch (e) {
    console.log("❌ ERRO:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});