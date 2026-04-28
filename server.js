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
  uniqueId: { type: String, unique: true } // 🔥 evita duplicado REAL
});

const Resultado = mongoose.model("Resultado", ResultadoSchema);

// ================= UTIL =================
function hoje() {
  return new Date().toISOString().split("T")[0];
}

function resultadoValido(r) {
  return !["0000", "1111", "9999", "2026"].includes(r.p1);
}

function limparDados(lista, dataHoje) {
  const vistos = new Set();

  return lista.filter(item => {
    if (item.data !== dataHoje) return false;

    if (vistos.has(item.uniqueId)) return false;
    vistos.add(item.uniqueId);

    if (!resultadoValido(item)) return false;

    return true;
  });
}

// ================= BANCA =================
function detectarBanca(horario) {
  horario = horario.toLowerCase();

  if (horario.includes("rio")) return "rio";
  if (horario.includes("goiás") || horario.includes("look")) return "look";
  if (horario.includes("nacional")) return "nacional";
  if (horario.includes("federal")) return "federal";

  return "outros";
}

// ================= SCRAPER =================
async function buscarResultados() {
  try {
    const { data } = await axios.get(
      "https://www.resultadosdobicho.com/resultado-do-jogo-do-bicho/",
      { timeout: 10000 }
    );

    const $ = cheerio.load(data);
    let resultados = [];

    $(".resultado").each((i, el) => {
      const horario = $(el).find("h2").text().trim();

      const numeros = $(el)
        .find("td")
        .map((i, td) => $(td).text().trim())
        .get();

      if (numeros.length >= 5) {
        resultados.push({
          banca: detectarBanca(horario),
          data: hoje(),
          horario,
          p1: numeros[0],
          p2: numeros[1],
          p3: numeros[2],
          p4: numeros[3],
          p5: numeros[4],
          uniqueId: `${hoje()}-${horario}-${numeros[0]}`
        });
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
  try {
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

    // federal só 1
    if (porBanca.federal.length > 1) {
      porBanca.federal = [porBanca.federal.pop()];
    }

    // 🔥 insert rápido (sem findOne)
    for (const banca in porBanca) {
      for (const item of porBanca[banca]) {
        try {
          await Resultado.create(item);
          console.log("Salvo:", item.uniqueId);
        } catch (err) {
          if (err.code === 11000) {
            // duplicado ignorado
          } else {
            console.log("Erro ao salvar:", err.message);
          }
        }
      }
    }

  } catch (err) {
    console.log("Erro geral:", err.message);
  }
}

// ================= API =================
app.get("/resultados", async (req, res) => {
  try {
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

  } catch (err) {
    res.status(500).json({ erro: "Erro no servidor" });
  }
});

// ================= AUTO UPDATE =================
setInterval(() => {
  console.log("Atualizando...");
  atualizarBanco();
}, 60000);

// start inicial
atualizarBanco();

// ================= START =================
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});