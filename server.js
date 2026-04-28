import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================= MONGO =================
mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/bicho");

const ResultadoSchema = new mongoose.Schema({
  banca: String,
  data: String,
  horario: String,
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String,
  uniqueId: String
});

const Resultado = mongoose.model("Resultado", ResultadoSchema);

// ================= UTIL =================
function hoje() {
  return new Date().toISOString().split("T")[0];
}

// 🔥 BLOQUEIO FORTE DE RESULTADO FAKE
function resultadoValido(r) {
  const invalidos = ["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "2026"];

  const lista = [r.p1, r.p2, r.p3, r.p4, r.p5];

  // bloqueia se QUALQUER prêmio for fake
  if (lista.some(n => invalidos.includes(n))) return false;

  // bloqueia se for "Extração"
  if (r.horario.toLowerCase().includes("extra")) return false;

  return true;
}

// remove duplicados + fake + fora da data
function limparDados(lista, dataHoje) {
  const vistos = new Set();

  return lista.filter(item => {

    if (item.data !== dataHoje) return false;

    if (!resultadoValido(item)) return false;

    if (vistos.has(item.uniqueId)) return false;
    vistos.add(item.uniqueId);

    return true;
  });
}

// ================= BANCA =================
function detectarBanca(horario) {
  const h = horario.toLowerCase();

  if (h.includes("rio")) return "rio";
  if (h.includes("goiás") || h.includes("look")) return "look";
  if (h.includes("nacional")) return "nacional";
  if (h.includes("federal")) return "federal";

  return "outros";
}

// ================= SCRAPER =================
async function buscarResultados() {
  try {
    const { data } = await axios.get("https://www.resultadosdobicho.com/resultado-do-jogo-do-bicho/");
    const $ = cheerio.load(data);

    let resultados = [];

    $(".resultado").each((i, el) => {

      const horario = $(el).find("h2").text().trim();

      const numeros = $(el)
        .find("td")
        .map((i, td) => $(td).text().trim())
        .get();

      if (numeros.length >= 5) {

        const banca = detectarBanca(horario);

        const item = {
          banca,
          data: hoje(),
          horario,
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4],
          uniqueId: `${hoje()}-${banca}-${horario}`
        };

        resultados.push(item);
      }
    });

    return resultados;

  } catch (err) {
    console.log("Erro scraping:", err.message);
    return [];
  }
}

// ================= SALVAR =================
async function atualizarBanco() {

  const dataHoje = hoje();

  let dados = await buscarResultados();

  dados = limparDados(dados, dataHoje);

  const porBanca = {
    rio: [],
    look: [],
    nacional: [],
    federal: []
  };

  dados.forEach(r => {
    if (porBanca[r.banca]) {
      porBanca[r.banca].push(r);
    }
  });

  // 🔥 FEDERAL = só 1 (último válido)
  if (porBanca.federal.length > 0) {
    porBanca.federal = [porBanca.federal[porBanca.federal.length - 1]];
  }

  for (const banca in porBanca) {
    for (const item of porBanca[banca]) {

      const existe = await Resultado.findOne({ uniqueId: item.uniqueId });

      if (!existe) {
        await Resultado.create(item);
        console.log("Salvo:", item.uniqueId);
      }
    }
  }
}

// ================= API =================
app.get("/resultados", async (req, res) => {

  const dataHoje = hoje();

  const dados = await Resultado.find({ data: dataHoje });

  const resposta = {
    atualizado: new Date().toLocaleString(),
    historico: {
      [dataHoje]: {
        rio: [],
        look: [],
        nacional: [],
        federal: []
      }
    }
  };

  dados.forEach(r => {
    if (resposta.historico[dataHoje][r.banca]) {
      resposta.historico[dataHoje][r.banca].push(r);
    }
  });

  res.json(resposta);
});

// ================= AUTO UPDATE =================
setInterval(() => {
  console.log("Atualizando...");
  atualizarBanco();
}, 60000);

// primeira execução
atualizarBanco();

// ================= START =================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});