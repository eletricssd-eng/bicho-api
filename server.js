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
// 🔧 FUNÇÕES
//////////////////////////////////////////////////

function normalizarHorario(h) {
  const match = h.match(/\b(\d{2})[:h]?/);
  return match ? match[1] : "00";
}

function pegarDataHoje() {
  return new Date().toISOString().split("T")[0];
}

// 🔥 extrai data do texto (principalmente federal)
function extrairData(texto) {
  const match = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (match) {
    const [dia, mes, ano] = match[1].split("/");
    return `${ano}-${mes}-${dia}`;
  }
  return pegarDataHoje();
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (AJUSTADO)
//////////////////////////////////////////////////

async function scraper(url, bancaNome) {
  try {

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];
    const vistos = new Set();

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if (!titulo) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\d{4}/);
        if (match) nums.push(match[0]);
      });

      if (nums.length >= 5) {

        const p = nums.slice(0, 5);

        const horario = normalizarHorario(titulo);
        const dataExtraida = extrairData(titulo);

        const chave = `${bancaNome}-${dataExtraida}-${horario}-${p.join("-")}`;

        if (vistos.has(chave)) return;
        vistos.add(chave);

        lista.push({
          banca: bancaNome,
          data: dataExtraida,
          horario,
          p1: p[0],
          p2: p[1],
          p3: p[2],
          p4: p[3],
          p5: p[4]
        });
      }

    });

    return lista;

  } catch (e) {
    console.log("❌ erro scraper:", url);
    return [];
  }
}

//////////////////////////////////////////////////
// 🏦 PEGAR DADOS
//////////////////////////////////////////////////

async function pegarTudo() {
  return [
    ...(await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje", "rio")),
    ...(await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje", "look")),
    ...(await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje", "nacional")),
    ...(await scraper("https://www.resultadofacil.com.br/resultado-banca-federal", "federal"))
  ];
}

//////////////////////////////////////////////////
// 💾 SALVAR
//////////////////////////////////////////////////

async function salvarBanco(lista) {

  for (const item of lista) {

    const uniqueId = `${item.data}-${item.banca}-${item.horario}-${item.p1}-${item.p2}-${item.p3}-${item.p4}-${item.p5}`;

    await Resultado.updateOne(
      { uniqueId },
      {
        $set: item
      },
      { upsert: true }
    );
  }

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO ORGANIZADO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const dados = await Resultado.find()
    .sort({ data: -1, horario: 1 });

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

    agrupado[r.data][r.banca].push({
      horario: r.horario,
      p1: r.p1,
      p2: r.p2,
      p3: r.p3,
      p4: r.p4,
      p5: r.p5
    });

  });

  return agrupado;
}

//////////////////////////////////////////////////
// 🚀 ROTAS
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    const lista = await pegarTudo();

    await salvarBanco(lista);

    const historico = await pegarHistorico();

    res.json({
      atualizado: new Date().toLocaleString(),
      historico
    });

  } catch (err) {
    console.log("❌ erro:", err.message);
    res.status(500).json({ erro: "Erro servidor" });
  }

});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(async () => {
  console.log("⏳ Atualizando...");

  const lista = await pegarTudo();
  await salvarBanco(lista);

}, 5 * 60 * 1000);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Rodando porta", PORT);
});