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

// ================= LOGIN SIMPLES =================
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "123") {
    return res.json({ token: "token123" });
  }

  res.json({ erro: "Login inválido" });
});

// ================= LER JSON =================
function lerDados() {
  if (!fs.existsSync(FILE)) {
    return { atualizado: "", historico: {} };
  }
  return JSON.parse(fs.readFileSync(FILE));
}

// ================= SALVAR JSON =================
function salvarDados(dados) {
  fs.writeFileSync(FILE, JSON.stringify(dados, null, 2));
}

// ================= FORMATAR DATA =================
function getHoje() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

// ================= SCRAPING REAL =================
async function pegarResultados() {
  try {
    const { data } = await axios.get("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje");

    const $ = cheerio.load(data);

    let resultados = [];

    $(".lottery-table tbody tr").each((i, el) => {
      const cols = $(el).find("td");

      if (cols.length >= 6) {
        resultados.push({
          horario: "19:00",
          p1: $(cols[1]).text().trim(),
          p2: $(cols[2]).text().trim(),
          p3: $(cols[3]).text().trim(),
          p4: $(cols[4]).text().trim(),
          p5: $(cols[5]).text().trim()
        });
      }
    });

    return resultados;

  } catch (e) {
    console.log("Erro scraping:", e.message);
    return [];
  }
}

// ================= ATUALIZAR =================
async function atualizar() {

  const dados = lerDados();
  const hoje = getHoje();

  if (!dados.historico[hoje]) {
    dados.historico[hoje] = {
      rio: [],
      look: [],
      nacional: [],
      federal: []
    };
  }

  const novosFederal = await pegarResultados();

  // 🔥 SÓ ATUALIZA SE TIVER DADOS
  if (novosFederal.length > 0) {
    dados.historico[hoje].federal = novosFederal;
  }

  dados.atualizado = new Date().toLocaleString("pt-BR");

  salvarDados(dados);

  console.log("Atualizado:", dados.atualizado);
}

// ================= AUTO UPDATE =================
setInterval(atualizar, 60000); // 1 min
atualizar();

// ================= ROTA =================
app.get("/resultados", (req, res) => {
  const dados = lerDados();
  res.json(dados);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("API rodando na porta", PORT);
});