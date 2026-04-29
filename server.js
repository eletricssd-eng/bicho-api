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
// 🔥 MONGO (robusto)
//////////////////////////////////////////////////

await mongoose.connect(process.env.MONGO_URL, {
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10
});

console.log("✅ Mongo conectado");

const Resultado = mongoose.model("Resultado", new mongoose.Schema({
  uniqueId: { type: String, unique: true, index: true },
  data: String,
  banca: { type: String, index: true },
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String
}, { timestamps: true }));

//////////////////////////////////////////////////
// 🧠 VALIDADOR ENTERPRISE
//////////////////////////////////////////////////

function resultadoValido(r) {
  if (!r) return false;

  const nums = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // formato 4 dígitos
  if (nums.some(n => !/^\d{4}$/.test(n))) return false;

  // bloqueia padrões fake
  const invalidos = new Set([
    "0000","1111","2222","3333","4444",
    "5555","6666","7777","8888","9999"
  ]);

  if (nums.some(n => invalidos.has(n))) return false;

  // bloqueia ano fake
  if (nums.some(n => n.startsWith("20"))) return false;

  // horário lixo
  if (!r.horario || r.horario.toLowerCase().includes("extra")) return false;

  // banca obrigatória
  if (!r.banca) return false;

  return true;
}

//////////////////////////////////////////////////
// 🔁 FETCH SAFE
//////////////////////////////////////////////////

async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      },
      timeout: 15000
    });

    return data;

  } catch {
    return null;
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPERS (com banca correta)
//////////////////////////////////////////////////

async function fonteRF() {
  const html = await fetchHTML("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje");
  if (!html) return [];

  const $ = cheerio.load(html);
  const lista = [];

  $("table").each((i, t) => {
    const nums = $(t).text().match(/\b\d{4}\b/g);

    if (nums?.length >= 5) {
      lista.push({
        banca: "rio",
        horario: "RF-" + i,
        p1: nums[0], p2: nums[1], p3: nums[2], p4: nums[3], p5: nums[4]
      });
    }
  });

  return lista;
}

async function fonteDNP() {
  const html = await fetchHTML("https://www.deunoposte.com/resultado-do-jogo-do-bicho-rj");
  if (!html) return [];

  const $ = cheerio.load(html);
  const lista = [];

  $("body").find("table,div").each((i, el) => {
    const nums = $(el).text().match(/\b\d{4}\b/g);

    if (nums?.length >= 5) {
      lista.push({
        banca: "rio",
        horario: "DNP-" + i,
        p1: nums[0], p2: nums[1], p3: nums[2], p4: nums[3], p5: nums[4]
      });
    }
  });

  return lista;
}

//////////////////////////////////////////////////
// 🧠 SCORE ENTERPRISE
//////////////////////////////////////////////////

function score(lista) {
  let s = 0;

  for (const r of lista) {
    if (!resultadoValido(r)) continue;

    s += 5;

    const set = new Set([r.p1, r.p2, r.p3, r.p4, r.p5]);
    if (set.size >= 4) s += 2;

    if (r.horario && !r.horario.includes("Alt")) s += 1;
  }

  return s;
}

//////////////////////////////////////////////////
// 🏆 SELETOR INTELIGENTE
//////////////////////////////////////////////////

async function escolherFonte() {

  const fontes = [
    { fn: fonteRF, nome: "RF" },
    { fn: fonteDNP, nome: "DNP" }
  ];

  let melhor = null;

  for (const f of fontes) {

    const dados = await f.fn();
    const validos = dados.filter(resultadoValido);
    const s = score(validos);

    console.log(`📊 ${f.nome} score:`, s);

    if (!melhor || s > melhor.score) {
      melhor = { dados: validos, score: s, nome: f.nome };
    }
  }

  if (!melhor) return [];

  console.log("🏆 fonte escolhida:", melhor.nome);

  return melhor.dados;
}

//////////////////////////////////////////////////
// 💾 STORAGE ENTERPRISE (sem duplicar + sem corrupção)
//////////////////////////////////////////////////

async function salvar(lista) {

  const hoje = new Date().toISOString().split("T")[0];

  const ops = lista
    .filter(resultadoValido)
    .map(r => ({
      updateOne: {
        filter: {
          uniqueId: `${hoje}-${r.banca}-${r.p1}-${r.p2}-${r.p3}-${r.p4}-${r.p5}`
        },
        update: {
          ...r,
          data: hoje,
          banca: r.banca
        },
        upsert: true
      }
    }));

  if (ops.length) {
    await Resultado.bulkWrite(ops, { ordered: false });
  }
}

//////////////////////////////////////////////////
// 🧹 LIMPEZA AUTOMÁTICA (enterprise)
//////////////////////////////////////////////////

async function limparLixo() {

  await Resultado.deleteMany({
    $or: [
      { p1: "9999" },
      { p2: "9999" },
      { p3: "2026" },
      { horario: "Extração" }
    ]
  });

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO CONSISTENTE
//////////////////////////////////////////////////

async function historico() {

  const dados = await Resultado.find().lean();
  const h = {};

  for (const r of dados) {

    if (!resultadoValido(r)) continue;

    if (!h[r.data]) {
      h[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    if (h[r.data][r.banca]) {
      h[r.data][r.banca].push(r);
    }
  }

  return h;
}

//////////////////////////////////////////////////
// ⚡ CACHE ENTERPRISE
//////////////////////////////////////////////////

let cache = null;
let last = 0;

async function carregar() {

  const now = Date.now();

  if (cache && now - last < 60000) {
    return cache;
  }

  const dados = await escolherFonte();

  if (dados.length) {
    await salvar(dados);
  }

  await limparLixo();

  cache = {
    atualizado: new Date().toLocaleString(),
    historico: await historico()
  };

  last = now;

  return cache;
}

//////////////////////////////////////////////////
// 🌐 API
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {
  try {
    res.json(await carregar());
  } catch (e) {
    res.status(500).json({
      erro: "internal_error",
      detalhe: e.message
    });
  }
});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API enterprise rodando na porta", PORT);
});