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
// 🔁 RETRY
//////////////////////////////////////////////////

async function tentar(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch {
      if (i === tentativas - 1) throw new Error("Falhou");
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

//////////////////////////////////////////////////
// 🔍 SCRAPER INTELIGENTE
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
    const vistos = new Set();

    $("table").each((i, tabela) => {

      const texto = $(tabela).closest("div").text();

      let match = texto.match(/(\d{1,2}[:h]\d{2})/);
      let horario = "00:00";

      if (match) {
        horario = match[1].replace("h", ":");
        if (horario.length === 4) horario = "0" + horario;
      }

      if (banca === "federal" && lista.length >= 1) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const m = $(tr).text().match(/\b\d{4}\b/g);
        if (m) nums.push(...m);
      });

      if (nums.length < 5) return;

      const chave = `${banca}-${horario}-${nums.join("-")}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);

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

  } catch {
    console.log("❌ erro scraper:", banca);
    return [];
  }
}

//////////////////////////////////////////////////
// 🔄 ATUALIZAR (ANTI-TRAVAMENTO)
//////////////////////////////////////////////////

async function atualizar() {

  console.log("⏳ Atualizando...", agoraBR());

  let rio = [], look = [], nacional = [], federal = [];

  try {
    [rio, look, nacional, federal] = await Promise.all([
      scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje", "rio"),
      scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje", "look"),
      scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje", "nacional"),
      scraper("https://www.resultadofacil.com.br/resultado-banca-federal", "federal")
    ]);
  } catch {
    console.log("❌ erro geral scraper");
  }

  console.log("📊", {
    rio: rio.length,
    look: look.length,
    nacional: nacional.length,
    federal: federal.length
  });

  const hoje = hojeBR();
  const dados = { rio, look, nacional, federal };

  let salvou = false;

  for (const banca in dados) {

    // 🔥 salva vazio se não tiver resultado
    if (!dados[banca] || dados[banca].length === 0) {

      const id = `${banca}-${hoje}-vazio`;

      await Resultado.updateOne(
        { uniqueId: id },
        {
          $set: {
            data: hoje,
            banca,
            horario: "00:00",
            p1: "",
            p2: "",
            p3: "",
            p4: "",
            p5: ""
          }
        },
        { upsert: true }
      );

      salvou = true;
      continue;
    }

    // 🔥 salva dados reais
    for (const item of dados[banca]) {

      const id = `${banca}-${item.data}-${item.horario}-${item.p1}`;

      await Resultado.updateOne(
        { uniqueId: id },
        { $set: { ...item, banca } },
        { upsert: true }
      );

      salvou = true;
    }
  }

  // 🔥 fallback final
  if (!salvou) {
    await Resultado.updateOne(
      { uniqueId: `force-${hoje}` },
      {
        $set: {
          data: hoje,
          banca: "rio",
          horario: "00:00",
          p1: "",
          p2: "",
          p3: "",
          p4: "",
          p5: ""
        }
      },
      { upsert: true }
    );
  }
}

//////////////////////////////////////////////////
// 📊 ROTA PRINCIPAL (FORMATO DO SEU APP)
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

      // 🔥 ignora registros vazios na resposta
      if (r.p1 === "") return;

      historico[r.data][r.banca].push({
        horario: r.horario,
        p1: r.p1,
        p2: r.p2,
        p3: r.p3,
        p4: r.p4,
        p5: r.p5
      });

    });

    // 🔥 garante dia atual SEMPRE
    const hoje = hojeBR();
    if (!historico[hoje]) {
      historico[hoje] = {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      };
    }

    // ordenar horários
    for (const d in historico) {
      for (const b in historico[d]) {
        historico[d][b].sort((a, b) =>
          a.horario.localeCompare(b.horario)
        );
      }
    }

    res.json({
      atualizado: agoraBR(),
      historico
    });

  } catch {
    res.json({
      atualizado: agoraBR(),
      historico: {}
    });
  }

});

//////////////////////////////////////////////////
// 🔄 LOOP
//////////////////////////////////////////////////

setInterval(atualizar, 180000);

// roda ao iniciar
atualizar();

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});