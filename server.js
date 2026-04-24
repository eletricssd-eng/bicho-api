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
// 📦 MODELS
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
// 🧠 HORÁRIOS FIXOS (SOLUÇÃO DEFINITIVA)
//////////////////////////////////////////////////

const HORARIOS = {
  rio: ["09:20","11:00","14:20","16:00","21:20"],
  look: ["07:00","09:00","11:00","14:00","16:00","18:00","21:00","23:00"],
  nacional: ["02:00","08:00","10:00","12:00","15:00","17:00","20:00","23:00"],
  federal: ["19:00"]
};

//////////////////////////////////////////////////
// 🧠 FUNÇÕES AUXILIARES
//////////////////////////////////////////////////

function extrairData(texto){
  const match = texto.match(/\d{2}\/\d{2}\/\d{4}/);
  if(match){
    const [d,m,a] = match[0].split("/");
    return `${a}-${m}-${d}`;
  }
  return new Date().toISOString().split("T")[0];
}

function numerosValidos(nums){
  return nums.length >= 5 && nums.every(n => /^\d{4}$/.test(n));
}

//////////////////////////////////////////////////
// 🔍 SCRAPER (CORRIGIDO)
//////////////////////////////////////////////////

async function scraper(url, banca) {

  try {

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const lista = [];
    const vistos = new Set();

    $("table").each((i, tabela) => {

      let titulo = $(tabela).prevAll("h2, h3, strong").first().text().trim();
      if (!titulo) return;

      const tituloLower = titulo.toLowerCase();

      // ignora federal duplicada
      if (tituloLower.includes("federal") && tituloLower.includes("1 ao 10")) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const matches = $(tr).text().match(/\b\d{4}\b/g);
        if (matches) nums.push(...matches);
      });

      const numeros = nums.slice(0, 5);

      if (!numerosValidos(numeros)) return;

      const chave = numeros.join("-");
      if (vistos.has(chave)) return;
      vistos.add(chave);

      const dataExtraida = extrairData(titulo);

      //////////////////////////////////////////////////
      // 🔥 HORÁRIO FIXO (AQUI ESTÁ A CORREÇÃO)
      //////////////////////////////////////////////////

      let horarioReal;

      if (banca === "federal") {
        if (lista.length >= 1) return; // trava duplicado
        horarioReal = "19:00";
      } else {
        horarioReal = HORARIOS[banca][lista.length];
      }

      if (!horarioReal) return;

      lista.push({
        data: dataExtraida,
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
// 🏦 PEGAR TUDO (PARALELO)
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

      const uniqueId = `${banca}-${item.data}-${item.horario}-${item.p1}`;

      await Resultado.updateOne(
        { uniqueId },
        {
          $set: {
            data: item.data,
            banca,
            horario: item.horario,
            p1: item.p1,
            p2: item.p2,
            p3: item.p3,
            p4: item.p4,
            p5: item.p5
          }
        },
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

    const existe = lista.some(i =>
      i.horario === r.horario && i.p1 === r.p1
    );

    if (!existe) {
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
// 🔄 ATUALIZAÇÃO SEGURA
//////////////////////////////////////////////////

let atualizando = false;

async function atualizar() {

  if (atualizando) return;
  atualizando = true;

  try {
    console.log("⏳ Atualizando...");
    const dados = await pegarTudo();
    await salvarBanco(dados);
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

    const historico = await pegarHistorico();

    res.json({
      atualizado: new Date().toLocaleString(),
      historico
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ erro: "Erro no servidor" });
  }

});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(atualizar, 3 * 60 * 1000);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});