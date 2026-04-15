import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔥 VERIFICA MONGO
//////////////////////////////////////////////////

if (!process.env.MONGO_URI) {
  console.log("❌ MONGO_URI não definida");
  process.exit(1);
}

//////////////////////////////////////////////////
// 🔗 CONEXÃO MONGODB (SEM AWAIT)
//////////////////////////////////////////////////

function conectarMongo() {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB conectado"))
    .catch(err => {
      console.log("❌ erro Mongo:", err.message);
      process.exit(1);
    });
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
// 🔍 SCRAPER (SEM DUPLICAÇÃO + FEDERAL CORRETA)
//////////////////////////////////////////////////

async function scraper(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    const jaVistos = new Set();

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if (!titulo) titulo = "Horário " + (i + 1);

      const tituloLower = titulo.toLowerCase();

      // 🔥 FEDERAL: só 1 ao 5
      const isFederal = tituloLower.includes("federal");
      const is5 = /1\s*(º|°)?\s*ao\s*5/.test(tituloLower);

      if (isFederal && !is5) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\d{4}/);
        if (match) nums.push(match[0]);
      });

      if (nums.length >= 5) {

        const numeros = nums.slice(0, 5);

        // 🔥 evita duplicado do site
        const assinatura = numeros.join("-");
        if (jaVistos.has(assinatura)) return;
        jaVistos.add(assinatura);

        lista.push({
          horario: titulo
            .replace(/1\s*(º|°)?\s*ao\s*10/gi, "")
            .replace(/1\s*(º|°)?\s*ao\s*5/gi, "")
            .replace(/resultado do dia/gi, "")
            .trim(),

          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4]
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
  return {
    rio: await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    look: await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    nacional: await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
    federal: await scraper("https://www.resultadofacil.com.br/resultado-banca-federal")
  };
}

//////////////////////////////////////////////////
// 💾 SALVAR NO BANCO (ANTI DUPLICAÇÃO)
//////////////////////////////////////////////////

async function salvarBanco(dados) {

  const dataHoje = new Date().toISOString().split("T")[0];

  for (const banca in dados) {

    for (const item of dados[banca]) {

      const uniqueId = `${dataHoje}-${banca}-${item.p1}-${item.p2}-${item.p3}-${item.p4}-${item.p5}`;

      try {
        await Resultado.create({
          uniqueId,
          data: dataHoje,
          banca,
          horario: item.horario,
          p1: item.p1,
          p2: item.p2,
          p3: item.p3,
          p4: item.p4,
          p5: item.p5
        });
      } catch (err) {
        if (err.code !== 11000) {
          console.log("Erro ao salvar:", err.message);
        }
      }

    }

  }

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const ultimos = await Resultado.find()
    .sort({ data: -1 })
    .limit(500);

  const agrupado = {};

  ultimos.forEach(r => {

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
// 🚀 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    const dados = await pegarTudo();

    await salvarBanco(dados);

    const historico = await pegarHistorico();

    res.json({
      atualizado: new Date().toLocaleString(),
      historico
    });

  } catch (err) {
    console.log("❌ erro rota:", err.message);
    res.status(500).json({ erro: "Erro no servidor" });
  }

});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});