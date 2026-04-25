import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const FILE = "dados.json";

// ================= LOGIN =================
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "123") {
    return res.json({ token: "token123" });
  }

  res.json({ erro: "Login inválido" });
});

// ================= BANCO LOCAL =================
function lerDados() {
  if (!fs.existsSync(FILE)) {
    return { atualizado: "", historico: {} };
  }
  return JSON.parse(fs.readFileSync(FILE));
}

function salvarDados(dados) {
  fs.writeFileSync(FILE, JSON.stringify(dados, null, 2));
}

// ================= DATA =================
function getHoje() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

// ================= SCRAPING FEDERAL =================
async function pegarFederal() {
  try {
    const url = "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje";

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(data);

    let resultados = [];

    // 🔥 seletor atualizado
    $("table tr").each((i, el) => {

      const tds = $(el).find("td");

      if (tds.length >= 6) {

        const p1 = $(tds[1]).text().trim();
        const p2 = $(tds[2]).text().trim();
        const p3 = $(tds[3]).text().trim();
        const p4 = $(tds[4]).text().trim();
        const p5 = $(tds[5]).text().trim();

        // só adiciona se válido
        if (p1 && p2 && p3) {
          resultados.push({
            horario: "19:00",
            p1,
            p2,
            p3,
            p4,
            p5
          });
        }
      }
    });

    console.log("📡 Federal capturado:", resultados.length);

    return resultados;

  } catch (e) {
    console.log("❌ erro scraping:", e.message);
    return [];
  }
}

// ================= FALLBACK =================
function pegarUltimoFederal(dados) {
  const datas = Object.keys(dados.historico)
    .sort((a,b)=> new Date(b) - new Date(a));

  for (let d of datas) {
    const fed = dados.historico[d]?.federal;
    if (fed && fed.length > 0) {
      return fed;
    }
  }

  return [];
}

// ================= ATUALIZAÇÃO =================
async function atualizar() {

  const dados = lerDados();
  const hoje = getHoje();

  // 🔥 cria dia só se precisar
  if (!dados.historico[hoje]) {
    dados.historico[hoje] = {
      rio: [],
      look: [],
      nacional: [],
      federal: []
    };
  }

  let federal = await pegarFederal();

  // 🔥 se scraping falhar, usa fallback
  if (federal.length === 0) {
    console.log("⚠️ usando fallback");
    federal = pegarUltimoFederal(dados);
  }

  // 🔥 só salva se tiver algo
  if (federal.length > 0) {
    dados.historico[hoje].federal = federal;
  }

  dados.atualizado = new Date().toLocaleString("pt-BR");

  salvarDados(dados);

  console.log("✅ atualizado:", dados.atualizado);
}

// ================= AUTO UPDATE =================
setInterval(atualizar, 60000); // 1 min
atualizar();

// ================= ROTAS =================
app.get("/resultados", (req, res) => {
  const dados = lerDados();
  res.json(dados);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});