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
// 🔗 CONEXÃO MONGO
//////////////////////////////////////////////////

if (!process.env.MONGO_URI) {
  console.log("❌ MONGO_URI não definida");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => {
    console.log("❌ erro Mongo:", err.message);
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
// 🔍 SCRAPER (CORRIGIDO)
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

      // 🔥 FEDERAL só 1 ao 5
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
// 💾 SALVAR NO BANCO (SEM DUPLICAR)
//////////////////////////////////////////////////

function normalizzarHorario(h) {
if (!h) return "00";
const match = h.match(/\d{1,2}/);
if (!match) return "00";
return match[0].padStart(2, "0");
}

async function salvarBanco(dados) {

  const dataHoje = new Date().toISOString().split("T")[0];

  for (const banca in dados) {

    for (const item of dados[banca]) {
      const hora = normalizarHorario(item.horario);

      const uniqueId = `${dataHoje}-${banca}-${hora}-${item.p1}-${item.p2}-${item.p3}-${item.p4}-${item.p5}`;

      try {

        await Resultado.updateOne(
          { uniqueId },
          {
            $set: {
              data: dataHoje,
              banca,
              horario: hora,
              p1: item.p1,
              p2: item.p2,
              p3: item.p3,
              p4: item.p4,
              p5: item.p5
            }
          },
          { upsert: true }
        );

        console.log("💾 SALVO:", uniqueId);

      } catch (err) {
        console.log("❌ erro salvar:", err.message);
      }

    }

  }

}

//////////////////////////////////////////////////
// 📊 HISTÓRICO
//////////////////////////////////////////////////

async function pegarHistorico() {

  const ultimos = await Resultado.find()
    .sort({ data: -1, horario: 1 })
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

    const existe = agrupado[r.data][r.banca]
      .some(i => i.p1 === r.p1 && i.horario === r.horario);

    if (!existe) {
      agrupado[r.data][r.banca].push({
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
// 🔐 LOGIN
//////////////////////////////////////////////////

app.post("/login", async (req, res) => {

  const { username, password } = req.body;

  const user = await User.findOne({ username });

  if (!user) return res.status(400).json({ erro: "Usuário não encontrado" });

  const ok = await bcrypt.compare(password, user.password);

  if (!ok) return res.status(400).json({ erro: "Senha inválida" });

  const token = jwt.sign({ id: user._id }, SECRET, {
    expiresIn: "7d"
  });

  res.json({ token });
});
app.post("/register", async (req,res)=>{
  const { username, password } = req.body;

  const hash = await bcrypt.hash(password, 10);

  await User.create({
    username,
    password: hash
  });

  res.json({ ok:true });
});

//////////////////////////////////////////////////
// 👤 CRIAR USER (usar 1x)
//////////////////////////////////////////////////

app.get("/criar-user", async (req, res) => {

  const existe = await User.findOne({ username: "admin" });

  if (existe) return res.send("Já existe");

  const hash = await bcrypt.hash("1234", 10);

  await User.create({
    username: "admin",
    password: hash
  });

  res.send("Usuário criado: admin / 1234");
});

//////////////////////////////////////////////////
// 🚀 ROTA PRINCIPAL (SEM AUTH)
//////////////////////////////////////////////////

app.get("/resultados", async (req, res) => {

  try {

    const dados = await pegarTudo();

    console.log("📊 DADOS:", Object.keys(dados));

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
// 🔄 AUTO ATUALIZAÇÃO
//////////////////////////////////////////////////

setInterval(async () => {
  console.log("⏳ Atualizando automático...");

  const dados = await pegarTudo();
  await salvarBanco(dados);

}, 5 * 60 * 1000);

//////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log("🚀 Server rodando na porta", PORT);
});