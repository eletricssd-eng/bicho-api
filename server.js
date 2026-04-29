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
// 🧠 VALIDAÇÃO
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  if (lista.some(n => !n)) return false;
  if (lista.some(n => !/^\d{4}$/.test(n))) return false;

  if (lista.some(n => /^(\d)\1{3}$/.test(n))) return false;
  if (lista.some(n => n.startsWith("20"))) return false;

  if (!r.horario || r.horario.toLowerCase().includes("extra")) return false;

  return true;
}

//////////////////////////////////////////////////
// 🧹 LIMPEZA
//////////////////////////////////////////////////

async function limparLixo() {
  if (mongoose.connection.readyState !== 1) return;

  await Resultado.deleteMany({
    $or: [
      { horario: /extra/i },
      { p1: /^20/ }, { p2: /^20/ }, { p3: /^20/ },
      { p4: /^20/ }, { p5: /^20/ },
      { p1: /^(\d)\1{3}$/ },
      { p2: /^(\d)\1{3}$/ },
      { p3: /^(\d)\1{3}$/ },
      { p4: /^(\d)\1{3}$/ },
      { p5: /^(\d)\1{3}$/ }
    ]
  });
}

setInterval(limparLixo, 5 * 60 * 1000);

//////////////////////////////////////////////////
// 🔁 FETCH RETRY
//////////////////////////////////////////////////

async function fetchRetry(url, tentativas = 3) {
  try {
    return await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
  } catch (e) {
    if (tentativas > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchRetry(url, tentativas - 1);
    }
    throw e;
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPER PRINCIPAL
//////////////////////////////////////////////////

async function scraper(url) {
  try {
    const { data } = await fetchRetry(url);
    const $ = cheerio.load(data);

    const lista = [];

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2,h3,strong").first().text().trim();
      if (!titulo) titulo = `Horario ${i+1}`;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\b\d{4}\b/g);
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
    console.log("❌ erro scraper principal:", e.message);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔄 SCRAPER ALTERNATIVO (DEU NO POSTE)
//////////////////////////////////////////////////

async function scraperAlternativo() {
  try {
    const { data } = await fetchRetry(
      "https://www.deunoposte.com/resultado-do-jogo-do-bicho-rj"
    );

    const $ = cheerio.load(data);
    const lista = [];

    $("body").find("table, div").each((i, el) => {
      const nums = $(el).text().match(/\b\d{4}\b/g);

      if (nums && nums.length >= 5) {
        lista.push({
          horario: "RJ Alt " + i,
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
    console.log("❌ erro fonte alternativa:", e.message);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 BANCAS (MULTI-FONTE)
//////////////////////////////////////////////////

async function pegarTudo() {

  let rio = await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje");

  // fallback automático
  if (!rio.length) {
    console.log("⚠️ usando fonte alternativa RJ");
    rio = await scraperAlternativo();
  }

  const [look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  ]);

  return {
    rio: rio.filter(resultadoValido),
    look: look.filter(resultadoValido),
    nacional: nacional.filter(resultadoValido),
    federal: federal.filter(resultadoValido).slice(0,1)
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvarMongo(dados) {

  if (mongoose.connection.readyState !== 1) return;

  const hoje = new Date().toISOString().split("T")[0];
  const ops = [];

  for (const banca in dados) {
    for (const item of dados[banca]) {

      if (!resultadoValido(item)) continue;

      const uniqueId = `${hoje}-${banca}-${item.p1}-${item.p2}-${item.p3}`;

      ops.push({
        updateOne: {
          filter: { uniqueId },
          update: { ...item, data: hoje, banca, uniqueId },
          upsert: true
        }
      });
    }
  }

  if (ops.length) {
    await Resultado.bulkWrite(ops);
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const dados = await Resultado.find().lean();
  const historico = {};

  dados.forEach(r => {

    if (!resultadoValido(r)) return;

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

  const dados = await pegarTudo();

  if (dados.rio.length || dados.look.length || dados.nacional.length) {
    await salvarMongo(dados);
  } else {
    console.log("⚠️ sem dados novos, mantendo histórico");
  }

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
    res.status(500).json({ erro: e.message });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});