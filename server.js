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
// 🇧🇷 TIMEZONE BRASIL
//////////////////////////////////////////////////

function agoraBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false
  });
}

function hojeBR() {
  const d = new Date().toLocaleString("en-CA", {
    timeZone: "America/Sao_Paulo"
  });
  return d.split(",")[0]; // yyyy-mm-dd
}

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
    console.log("❌ erro mongo:", err.message);
    process.exit(1);
  });

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
// 🧠 HORÁRIOS
//////////////////////////////////////////////////

const HORARIOS = {
  rio: ["09:20","11:00","14:20","16:00","21:20"],
  look: ["07:00","09:00","11:00","14:00","16:00","18:00","21:00","23:00"],
  nacional: ["02:00","08:00","10:00","12:00","15:00","17:00","20:00","23:00"],
  federal: ["19:00"]
};

//////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////

function extrairData(texto){
  const match = texto.match(/\d{2}\/\d{2}\/\d{4}/);
  if(match){
    const [d,m,a] = match[0].split("/");
    return `${a}-${m}-${d}`;
  }
  return hojeBR(); // 🔥 usa Brasil
}

function detectarFaltantes(dados) {
  const faltando = {};
  for (const banca in HORARIOS) {
    const esperados = HORARIOS[banca];
    const recebidos = (dados[banca] || []).map(i => i.horario);
    const faltantes = esperados.filter(h => !recebidos.includes(h));
    if (faltantes.length > 0) faltando[banca] = faltantes;
  }
  return faltando;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (CORRIGIDO)
//////////////////////////////////////////////////

async function scraper(url, banca) {

  try {

    const { data } = await axios.get(url + "?t=" + Date.now(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Cache-Control": "no-cache"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const lista = [];
    const vistos = new Set();

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if (!titulo) return;

      const tituloLower = titulo.toLowerCase();

      if (tituloLower.includes("federal") && tituloLower.includes("1 ao 10")) return;

      let horarioMatch = titulo.match(/\d{2}:\d{2}/);
      let horarioReal = horarioMatch ? horarioMatch[0] : null;

      if (banca === "federal") horarioReal = "19:00";

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const matches = $(tr).text().match(/\b\d{4}\b/g);
        if (matches) nums.push(...matches);
      });

      const numeros = nums.slice(0, 5);
      if (numeros.length < 5) return;

      const chave = `${banca}-${horarioReal}-${numeros.join("-")}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);

      lista.push({
        data: extrairData(titulo),
        horario: horarioReal,
        p1: numeros[0],
        p2: numeros[1],
        p3: numeros[2],
        p4: numeros[3],
        p5: numeros[4]
      });

    });

    return lista;

  } catch (e) {
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 PEGAR TODAS
//////////////////////////////////////////////////

async function pegarTudo() {
  const [rio, look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje", "rio"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje", "look"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje", "nacional"),
    scraper("https://www.resultadofacil.com.br/resultado-banca-federal", "federal")
  ]);
  return { rio, look, nacional, federal };
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvarBanco(dados) {

  for (const banca in dados) {
    for (const item of dados[banca]) {

      if (!item.horario) continue;

      const uniqueId = `${banca}-${item.data}-${item.horario}-${item.p1}`;

      await Resultado.updateOne(
        { uniqueId },
        { $set: { ...item, banca } },
        { upsert: true }
      );

    }
  }
}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const dados = await Resultado.find()
    .sort({ data: -1, horario: 1 })
    .limit(1000);

  const agrupado = {};

  dados.forEach(r => {

    if (!agrupado[r.data]) {
      agrupado[r.data] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    const lista = agrupado[r.data][r.banca];

    if (!lista.some(i => i.horario === r.horario && i.p1 === r.p1)) {
      lista.push({
        horario: r.horario,
        p1: r.p1,
        p2: r.p2,
        p3: r.p3,
        p4: r.p4,
        p5: r.p5
      });
    }

  });

  return agrupado;
}

//////////////////////////////////////////////////
// 🔁 RETRY
//////////////////////////////////////////////////

async function buscarFaltantesComRetry(max = 3) {

  for (let i = 1; i <= max; i++) {

    console.log(`🔁 Retry ${i}`);

    const dados = await pegarTudo();
    await salvarBanco(dados);

    const faltando = detectarFaltantes(dados);

    if (Object.keys(faltando).length === 0) {
      console.log("✅ Completo");
      return;
    }

    console.log("⚠️ Ainda faltando:", faltando);

    await new Promise(r => setTimeout(r, 15000));
  }
}

//////////////////////////////////////////////////
// 🔄 ATUALIZAÇÃO
//////////////////////////////////////////////////

let atualizando = false;

async function atualizar() {

  if (atualizando) return;
  atualizando = true;

  try {

    console.log("⏳ Atualizando...", agoraBR());

    const dados = await pegarTudo();

    await salvarBanco(dados);

    const faltando = detectarFaltantes(dados);

    if (Object.keys(faltando).length > 0) {
      console.log("⚠️ Faltando, tentando completar...");
      await buscarFaltantesComRetry(3);
    } else {
      console.log("✅ Completo");
    }

  } catch (e) {
    console.log("❌ erro atualizar:", e.message);
  }

  atualizando = false;
}

//////////////////////////////////////////////////
// 🌐 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    await atualizar();

    const historico = await pegarHistorico();

    const hoje = hojeBR();

    const hojeDados = historico[hoje] || {};

    const faltando = detectarFaltantes(hojeDados);

    res.json({
      atualizado: agoraBR(),
      historico,
      faltando
    });

  } catch (err) {
    res.status(500).json({ erro: "Erro no servidor" });
  }

});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(atualizar, 60 * 1000);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});