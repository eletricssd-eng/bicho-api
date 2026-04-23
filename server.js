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

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});

const User = mongoose.model("User", UserSchema);

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

function extrairHorario(texto) {
  const match = texto.match(/\d{2}:\d{2}/);
  return match ? match[0] : null;
}

function numerosValidos(nums){
  return nums.length >= 5 && nums.every(n => /^\d{4}$/.test(n));
}

//////////////////////////////////////////////////
// 🔍 SCRAPER MELHORADO
//////////////////////////////////////////////////

async function scraper(url, banca) {

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

      const tituloLower = titulo.toLowerCase();

      // ignora federal duplicada
      if (tituloLower.includes("federal") && tituloLower.includes("1 ao 10")) return;

      const nums = [];

      $(tabela).find("tr").each((i, tr) => {
        const match = $(tr).text().match(/\b\d{4}\b/g);
        if (match) nums.push(...match);
      });

      const numeros = nums.slice(0, 5);

      if (!numerosValidos(numeros)) return;

      const chave = numeros.join("-");
      if (vistos.has(chave)) return;
      vistos.add(chave);

      const dataExtraida = extrairData(titulo);

      let horarioReal = extrairHorario(titulo);

      // fallback se não tiver horário
      if (!horarioReal) {
        if (banca === "federal") horarioReal = "19:00";
        else return; // ignora se não tiver horário claro
      }

      console.log("✔", banca, horarioReal, numeros);

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
// 🏦 PEGAR TUDO
//////////////////////////////////////////////////

async function pegarTudo() {
  return {
    rio: await scraper("https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje", "rio"),
    look: await scraper("https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje", "look"),
    nacional: await scraper("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje", "nacional"),
    federal: await scraper("https://www.resultadofacil.com.br/resultado-banca-federal", "federal")
  };
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
// 🔄 ATUALIZAÇÃO INTELIGENTE
//////////////////////////////////////////////////

async function atualizarComRetry() {

  console.log("⏳ Atualizando...");

  const dados = await pegarTudo();

  const incompleto =
    dados.look.length < 7 ||
    dados.rio.length < 5;

  if (incompleto) {
    console.log("⚠️ Dados incompletos, tentando novamente depois...");
    return;
  }

  await salvarBanco(dados);

  console.log("✅ Atualizado com sucesso");
}

//////////////////////////////////////////////////
// 🌐 ROTA
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    await atualizarComRetry();
    const dados = await Resultado.find().sort({ data: -1 });

    res.json({
      atualizado: new Date().toLocaleString(),
      historico: dados
    });

  } catch (err) {
    res.status(500).json({ erro: "Erro no servidor" });
  }

});

//////////////////////////////////////////////////
// 🔄 AUTO UPDATE
//////////////////////////////////////////////////

setInterval(atualizarComRetry, 5 * 60 * 1000);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});