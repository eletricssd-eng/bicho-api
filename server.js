import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 MONGO
//////////////////////////////////////////////////

await mongoose.connect(process.env.MONGO_URL);
console.log("✅ Mongo conectado");

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true },
  hash: String,
  data: String,
  banca: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String,
  fonte: String
}));

//////////////////////////////////////////////////
// 🧠 VALIDAÇÃO ENTERPRISE
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const nums = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // formato correto
  if (nums.some(n => !/^\d{4}$/.test(n))) return false;

  // lixo repetido
  if (nums.some(n => /^(\d)\1{3}$/.test(n))) return false;

  // anti fake padrão
  if (nums.includes("0000")) return false;

  // bloqueia data inválida
  if (!r.horario || r.horario.toLowerCase().includes("extração") === false && r.horario.length < 3) {
    return false;
  }

  return true;
}

//////////////////////////////////////////////////
// 🔐 HASH (DEDUP ENTERPRISE)
//////////////////////////////////////////////////

function gerarHash(r) {
  return crypto
    .createHash("md5")
    .update(`${r.p1}-${r.p2}-${r.p3}-${r.p4}-${r.p5}-${r.horario}`)
    .digest("hex");
}

//////////////////////////////////////////////////
// 🌐 FETCH BASE
//////////////////////////////////////////////////

async function fetchHTML(url) {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "pt-BR"
    },
    timeout: 15000
  });
  return data;
}

//////////////////////////////////////////////////
// 🔍 FONTES (ROBUSTAS)
//////////////////////////////////////////////////

async function fonteResultadoFacil() {
  try {
    const html = await fetchHTML("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje");
    const $ = cheerio.load(html);

    const lista = [];

    $("table").each((i, t) => {
      const nums = $(t).text().match(/\b\d{4}\b/g);

      if (nums && nums.length >= 5) {
        lista.push({
          horario: "RF-" + i,
          p1: nums[0], p2: nums[1], p3: nums[2], p4: nums[3], p5: nums[4],
          fonte: "resultadofacil"
        });
      }
    });

    return lista;
  } catch {
    return [];
  }
}

async function fonteDeuNoPoste() {
  try {
    const html = await fetchHTML("https://www.deunoposte.com/resultado-do-jogo-do-bicho-rj");
    const $ = cheerio.load(html);

    const lista = [];

    $("table,div").each((i, el) => {
      const nums = $(el).text().match(/\b\d{4}\b/g);

      if (nums && nums.length >= 5) {
        lista.push({
          horario: "DNP-" + i,
          p1: nums[0], p2: nums[1], p3: nums[2], p4: nums[3], p5: nums[4],
          fonte: "deunoposte"
        });
      }
    });

    return lista;
  } catch {
    return [];
  }
}

//////////////////////////////////////////////////
// 🧠 SCORE ENTERPRISE
//////////////////////////////////////////////////

function score(r) {
  let s = 0;

  if (resultadoValido(r)) s += 5;

  const set = new Set([r.p1, r.p2, r.p3, r.p4, r.p5]);
  if (set.size >= 4) s += 2;

  if (r.fonte === "resultadofacil") s += 2;
  if (r.fonte === "deunoposte") s += 1;

  return s;
}

//////////////////////////////////////////////////
// 🏆 AGREGADOR MULTI-FONTE
//////////////////////////////////////////////////

async function coletarMelhorFonte() {
  const fontes = [
    await fonteResultadoFacil(),
    await fonteDeuNoPoste()
  ];

  const todos = fontes.flat().filter(resultadoValido);

  // ranking
  todos.sort((a, b) => score(b) - score(a));

  return todos;
}

//////////////////////////////////////////////////
// 🧹 LIMPEZA DE LIXO AUTOMÁTICA
//////////////////////////////////////////////////

async function limparLixo() {
  const lixo = await Resultado.deleteMany({
    $or: [
      { p1: "2026" },
      { p2: "2026" },
      { p3: "2026" },
      { p4: "2026" },
      { p5: "2026" }
    ]
  });

  if (lixo.deletedCount > 0) {
    console.log("🧹 lixo removido:", lixo.deletedCount);
  }
}

//////////////////////////////////////////////////
// 💾 SALVAR ENTERPRISE
//////////////////////////////////////////////////

async function salvar(lista) {
  const hoje = new Date().toISOString().split("T")[0];

  const ops = lista.map(r => {
    const hash = gerarHash(r);

    return {
      updateOne: {
        filter: { hash },
        update: {
          ...r,
          hash,
          data: hoje,
          banca: "mix"
        },
        upsert: true
      }
    };
  });

  if (ops.length) {
    await Resultado.bulkWrite(ops);
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO ORGANIZADO
//////////////////////////////////////////////////

async function historico() {
  const dados = await Resultado.find().lean();

  const h = {};

  for (const r of dados) {
    if (!resultadoValido(r)) continue;

    if (!h[r.data]) {
      h[r.data] = { rio: [], look: [], nacional: [], federal: [] };
    }

    const banca = h[r.data][r.banca || "rio"];
    if (banca) banca.push(r);
  }

  return h;
}

//////////////////////////////////////////////////
// 🚀 CACHE ENTERPRISE
//////////////////////////////////////////////////

let cache = null;
let tempo = 0;

async function carregar() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    return cache;
  }

  const dados = await coletarMelhorFonte();

  await salvar(dados);

  await limparLixo();

  const hist = await historico();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico: hist
  };

  tempo = agora;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {
  try {
    res.json(await carregar());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.listen(PORT, () => {
  console.log("🚀 API ENTERPRISE rodando na porta", PORT);
});