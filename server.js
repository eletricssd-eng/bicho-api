import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

//////////////////////////////////////////////////
// 🔗 CONEXÃO MONGODB (GARANTIDA)
//////////////////////////////////////////////////

async function conectarMongo() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB conectado");
  } catch (err) {
    console.log("❌ erro Mongo:", err.message);
  }
}

await conectarMongo();

//////////////////////////////////////////////////
// 📦 MODEL
//////////////////////////////////////////////////

const ResultadoSchema = new mongoose.Schema({
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
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if (!titulo) titulo = "Horário " + (i + 1);

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\d{4}/);
        if (match) nums.push(match[0]);
      });

      const tituloLower = titulo.toLowerCase();

      const isFederal = tituloLower.includes("federal");
      const is10 = tituloLower.includes("1 ao 10");

      // remove federal duplicada
      if (isFederal && is10) return;

      if (nums.length >= 5) {
        lista.push({
          horario: titulo
            .replace(/1 ao 10º?/gi, "")
            .replace(/1 ao 5º?/gi, "")
            .replace(/resultado do dia/gi, "")
            .trim(),

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
// 💾 SALVAR NO BANCO (SEM DUPLICAR)
//////////////////////////////////////////////////

async function salvarBanco(dados) {

  const dataHoje = new Date().toISOString().split("T")[0];

  for (const banca in dados) {

    for (const item of dados[banca]) {

      const existe = await Resultado.findOne({
        data: dataHoje,
        banca,
        horario: item.horario
      });

      if (existe) continue;

      await Resultado.create({
        data: dataHoje,
        banca,
        horario: item.horario,
        p1: item.p1,
        p2: item.p2,
        p3: item.p3,
        p4: item.p4,
        p5: item.p5
      });

    }

  }

}

//////////////////////////////////////////////////
// 📊 BUSCAR HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const ultimos = await Resultado.find()
    .sort({ data: -1 })
    .limit(300);

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

  const dados = await pegarTudo();

  await salvarBanco(dados);

  const historico = await pegarHistorico();

  res.json({
    atualizado: new Date().toLocaleString(),
    historico
  });

});

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});