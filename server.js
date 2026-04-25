import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
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

// ================= BANCO =================
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
  return new Date().toISOString().split("T")[0];
}

// ================= SCRAPER =================
async function scraper() {

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  let resultado = {
    rio: [],
    look: [],
    nacional: [],
    federal: []
  };

  try {

    // 🔥 SITE BASE (FUNCIONA COM JS)
    await page.goto("https://www.resultadofacil.com.br/", {
      waitUntil: "networkidle2",
      timeout: 0
    });

    // ================= FEDERAL =================
    await page.goto("https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje");

    await page.waitForSelector("table");

    const federal = await page.evaluate(() => {
      let out = [];

      document.querySelectorAll("table tr").forEach(tr => {

        const td = tr.querySelectorAll("td");

        if (td.length >= 6) {
          out.push({
            horario: "19:00",
            p1: td[1].innerText.trim(),
            p2: td[2].innerText.trim(),
            p3: td[3].innerText.trim(),
            p4: td[4].innerText.trim(),
            p5: td[5].innerText.trim()
          });
        }
      });

      return out;
    });

    resultado.federal = federal;

    // ================= OUTRAS BANCAS =================
    // 👉 você pode adicionar mais páginas aqui depois

  } catch (e) {
    console.log("Erro scraping:", e.message);
  }

  await browser.close();

  return resultado;
}

// ================= FALLBACK =================
function pegarUltimo(dados, banca) {
  const datas = Object.keys(dados.historico)
    .sort((a,b)=> new Date(b) - new Date(a));

  for (let d of datas) {
    const lista = dados.historico[d]?.[banca];
    if (lista && lista.length > 0) return lista;
  }

  return [];
}

// ================= ATUALIZAÇÃO =================
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

  const novos = await scraper();

  ["rio","look","nacional","federal"].forEach(banca => {

    let lista = novos[banca];

    if (!lista || lista.length === 0) {
      lista = pegarUltimo(dados, banca);
    }

    if (lista && lista.length > 0) {
      dados.historico[hoje][banca] = lista;
    }

  });

  dados.atualizado = new Date().toLocaleString("pt-BR");

  salvarDados(dados);

  console.log("✅ atualizado:", dados.atualizado);
}

// ================= LOOP =================
setInterval(atualizar, 120000); // 2 min
atualizar();

// ================= ROTAS =================
app.get("/resultados", (req, res) => {
  res.json(lerDados());
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 API PROFISSIONAL rodando");
});