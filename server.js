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
  const d = new Date().toLocaleString("en-US", {
    timeZone: "America/Sao_Paulo"
  });
  return new Date(d).toISOString().split("T")[0];
}

//////////////////////////////////////////////////
// 🔗 MONGO
//////////////////////////////////////////////////

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo conectado"))
  .catch(err => console.log("❌ erro mongo:", err));

//////////////////////////////////////////////////
// 📦 MODEL
//////////////////////////////////////////////////

const Resultado = mongoose.model("Resultado", {
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

function extrairHorario(texto) {
  const m = texto.match(/(\d{1,2})[:h](\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2,"0")}:${m[2]}`;
}

function detectarFaltantes(dados) {
  const faltando = {};
  for (const banca in HORARIOS) {
    const recebidos = (dados[banca] || []).map(i => i.horario);
    const diff = HORARIOS[banca].filter(h => !recebidos.includes(h));
    if (diff.length) faltando[banca] = diff;
  }
  return faltando;
}

//////////////////////////////////////////////////
// 🔍 SCRAPER ROBUSTO
//////////////////////////////////////////////////

async function scraper(url, banca) {

  try {

    const { data } = await axios.get(url + "?nocache=" + Date.now(), {
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

      let titulo = $(tabela).closest("div").text();

      let horario = extrairHorario(titulo);

      if (!horario && HORARIOS[banca]) {
        horario = HORARIOS[banca][lista.length];
      }

      if (!horario) return;

      // 🔥 federal só 1 resultado
      if (banca === "federal" && lista.length > 0) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const m = $(tr).text().match(/\b\d{4}\b/g);
        if (m) nums.push(...m);
      });

      const numeros = nums.slice(0, 5);

      if (numeros.length < 5) return;

      const chave = `${banca}-${horario}-${numeros.join("-")}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);

      lista.push({
        data: hojeBR(),
        horario,
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
// 🔄 ATUALIZAÇÃO
//////////////////////////////////////////////////

async function atualizar() {
  console.log("⏳ Atualizando...", agoraBR());

  const [rio, look, nacional, federal] = await Promise.all([
    scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje", "rio"),
    scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje", "look"),
    scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje", "nacional"),
    scraper("https://www.resultadofacil.com.br/resultado-banca-federal", "federal")
  ]);

  const dados = { rio, look, nacional, federal };

  for (const banca in dados) {
    for (const item of dados[banca]) {

      const id = `${banca}-${item.data}-${item.horario}-${item.p1}`;

      await Resultado.updateOne(
        { uniqueId: id },
        { $set: { ...item, banca } },
        { upsert: true }
      );

    }
  }
}

//////////////////////////////////////////////////
// 📊 BUSCAR HOJE (COM FALLBACK)
//////////////////////////////////////////////////

async function buscarResultados() {

  const hoje = hojeBR();

  let dados = await Resultado.find({ data: hoje });

  let dataUsada = hoje;
  let origem = "hoje";

  // 🔥 fallback automático
  if (dados.length === 0) {

    console.log("⚠️ Sem dados hoje, buscando anterior...");

    const ultimo = await Resultado.findOne().sort({ data: -1 });

    if (ultimo) {
      dados = await Resultado.find({ data: ultimo.data });
      dataUsada = ultimo.data;
      origem = "anterior";
    }

  }

  const res = { rio: [], look: [], nacional: [], federal: [] };

  dados.forEach(r => {
    res[r.banca].push({
      horario: r.horario,
      p1: r.p1,
      p2: r.p2,
      p3: r.p3,
      p4: r.p4,
      p5: r.p5
    });
  });

  return { resultados: res, dataUsada, origem };
}

//////////////////////////////////////////////////
// 🌐 ROTA PRINCIPAL
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    const { resultados, dataUsada, origem } = await buscarResultados();

    const faltando = detectarFaltantes(resultados);

    res.json({
      atualizado: agoraBR(),
      dataReferencia: dataUsada,
      origem,
      resultados,
      faltando
    });

  } catch (e) {
    console.log(e);
    res.status(500).json({ erro: "Erro servidor" });
  }

});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(atualizar, 60000);

// roda ao iniciar
atualizar();

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});