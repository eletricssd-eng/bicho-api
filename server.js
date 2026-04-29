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
// 🧠 VALIDAÇÃO FORTE (ANTI LIXO)
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // precisa existir
  if (lista.some(n => !n)) return false;

  // precisa ser 4 dígitos
  if (lista.some(n => !/^\d{4}$/.test(n))) return false;

  // bloqueia repetição (1111, 9999)
  if (lista.some(n => /^(\d)\1{3}$/.test(n))) return false;

  // bloqueia anos (2026 etc)
  if (lista.some(n => n.startsWith("20"))) return false;

  // bloqueia todos iguais
  if (new Set(lista).size === 1) return false;

  // bloqueia fallback fake
  if (!r.horario || r.horario.toLowerCase().includes("extra")) return false;

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
// 🔍 SCRAPER
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

    // fallback (NÃO confiável, só retorna)
    if (lista.length === 0) {
      console.log("⚠️ fallback usado:", url);

      const texto = $("body").text();
      const numeros = texto.match(/\b\d{4}\b/g);

      if (numeros && numeros.length >= 5) {
        lista.push({
          horario: "Extração",
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4]
        });
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

  // data de hoje no formato BR
  const hojeBR = new Date().toLocaleDateString("pt-BR");

  const federal = federalRaw.filter(r =>
    resultadoValido(r) && r.horario.includes(hojeBR)
  ).slice(0,1);

  return {
    rio: rio.filter(resultadoValido),
    look: look.filter(resultadoValido),
    nacional: nacional.filter(resultadoValido),
    federal
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR
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
    console.log("✅ salvo:", ops.length);
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

  // ordenar horários
  for (const data in historico) {
    for (const banca in historico[data]) {
      historico[data][banca].sort((a,b)=>
        a.horario.localeCompare(b.horario)
      );
    }
  }

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

  console.log("🔄 atualizando...");

  const dados = await pegarTudo();

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