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
// 🇧🇷 DATA BR
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
  .then(async () => {
    console.log("✅ Mongo conectado");
    await Resultado.collection.createIndex({ uniqueId: 1 }, { unique: true });
  })
  .catch(err => console.log("❌ erro mongo:", err));

//////////////////////////////////////////////////
// 📦 MODEL
//////////////////////////////////////////////////

const Resultado = mongoose.model("Resultado", {
  uniqueId: String,
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
// 🔁 RETRY
//////////////////////////////////////////////////

async function tentar(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPER
//////////////////////////////////////////////////

async function scraper(url, banca) {
  try {

    const { data } = await tentar(() =>
      axios.get(url + "?nocache=" + Date.now(), {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000
      })
    );

    const $ = cheerio.load(data);
    const lista = [];

    $("table").each((i, tabela) => {

      let horario = HORARIOS[banca]?.[i];
      if (!horario) return;

      if (banca === "federal" && lista.length >= 1) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const m = $(tr).text().match(/\b\d{4}\b/g);
        if (m) nums.push(...m);
      });

      if (nums.length < 5) return;

      lista.push({
        data: hojeBR(),
        horario,
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        p4: nums[3],
        p5: nums[4]
      });

    });

    return lista;

  } catch (e) {
    console.log("❌ erro scraper:", banca);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔄 ATUALIZAR
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

    if (!dados[banca] || dados[banca].length === 0) {
      console.log(`⚠️ ${banca} vazio`);
      continue;
    }

    for (const item of dados[banca]) {

      const id = `${banca}-${item.data}-${item.horario}-${item.p1}-${item.p2}-${item.p3}-${item.p4}-${item.p5}`;

      try {
        await Resultado.updateOne(
          { uniqueId: id },
          { $set: { ...item, banca } },
          { upsert: true }
        );

        console.log(`✅ ${banca} ${item.horario}`);
      } catch (e) {
        console.log("❌ erro salvar:", id);
      }
    }
  }
}

//////////////////////////////////////////////////
// 📊 ROTA (FORMATO DO SEU APP)
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    const dados = await Resultado.find().sort({ data: -1 });

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

      historico[r.data][r.banca].push({
        horario: r.horario,
        p1: r.p1,
        p2: r.p2,
        p3: r.p3,
        p4: r.p4,
        p5: r.p5
      });

    });

    // ordenar tudo
    for (const data in historico) {
      for (const banca in historico[data]) {
        historico[data][banca].sort((a, b) =>
          a.horario.localeCompare(b.horario)
        );
      }
    }

    res.json({
      atualizado: agoraBR(),
      historico
    });

  } catch (e) {

    console.log("❌ erro rota");

    res.json({
      atualizado: agoraBR(),
      historico: {}
    });

  }

});

//////////////////////////////////////////////////
// 🔄 LOOP SEGURO
//////////////////////////////////////////////////

setInterval(async () => {
  try {
    await atualizar();
  } catch (e) {
    console.log("🔥 erro loop");
  }
}, 180000); // 3 min

// primeira execução
(async () => {
  try {
    await atualizar();
  } catch (e) {
    console.log("❌ erro inicial");
  }
})();

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});