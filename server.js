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
// 🧠 VALIDAÇÃO BLINDADA
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // precisa ter 5 números
  if (lista.length !== 5) return false;
  if (lista.some(n => !n)) return false;

  // bloqueia placeholders comuns
  if (lista.some(n => /^(\d)\1{3}$/.test(n))) return false;

  return true;
}

//////////////////////////////////////////////////
// 🔁 AXIOS COM RETRY
//////////////////////////////////////////////////

async function fetchRetry(url, tentativas = 3) {
  try {
    return await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "pt-BR,pt;q=0.9"
      },
      timeout: 15000
    });
  } catch (e) {
    if (tentativas > 0) {
      console.log("🔁 retry:", url);
      await new Promise(r => setTimeout(r, 2000));
      return fetchRetry(url, tentativas - 1);
    }
    throw e;
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPER BLINDADO
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
        const item = {
          horario: titulo,
          p1: nums[0],
          p2: nums[1],
          p3: nums[2],
          p4: nums[3],
          p5: nums[4]
        };

        if (resultadoValido(item)) {
          lista.push(item);
        }
      }
    });

    // 🔥 fallback se HTML mudar
    if (lista.length === 0) {
      const texto = $("body").text();
      const numeros = texto.match(/\b\d{4}\b/g);

      if (numeros && numeros.length >= 5) {
        const item = {
          horario: "Extração",
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4]
        };

        if (resultadoValido(item)) {
          lista.push(item);
        }
      }
    }

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
  const [rio, look, nacional, federalRaw] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  ]);

  const federal = federalRaw.filter(resultadoValido).slice(0, 1);

  return { rio, look, nacional, federal };
}

//////////////////////////////////////////////////
// 💾 SALVAR ULTRA RÁPIDO (BULK)
//////////////////////////////////////////////////

async function salvarMongo(dados) {

  if (mongoose.connection.readyState !== 1) {
    console.log("⚠️ Mongo offline");
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];
  const ops = [];

  for (const banca in dados) {
    for (const item of dados[banca]) {

      if (!resultadoValido(item)) continue;

      // 🔥 unique baseado nos números (nunca duplica)
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

  if (ops.length > 0) {
    await Resultado.bulkWrite(ops);
    console.log("✅ salvo em lote:", ops.length);
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
// 🚀 CACHE INTELIGENTE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregarTudo() {

  const agora = Date.now();

  if (cache && (agora - tempo < 60000)) {
    return cache;
  }

  console.log("🔄 atualizando...");

  const dados = await pegarTudo();

  // 🔥 se scraper falhar, não quebra app
  if (!dados.rio.length && cache) {
    console.log("⚠️ usando cache (scraper falhou)");
    return cache;
  }

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