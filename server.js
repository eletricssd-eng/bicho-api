const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

// 🧠 HISTÓRICO (memória)
let historico = [];

// 🔄 FUNÇÃO DE SCRAPING
async function buscarResultado() {
  try {
    const url = "https://www.resultadofacil.com.br/resultado-do-bicho/";

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const texto = $("body").text();

    const milhares = texto.match(/\b\d{4}\b/g) || [];

    if (milhares.length < 5) {
      throw new Error("Dados insuficientes");
    }

    let resultados = [];

    for (let i = 0; i < 5; i++) {
      let milhar = milhares[i];

      resultados.push({
        premio: `${i + 1}º`,
        milhar,
        dezena: milhar.slice(-2),
        data: new Date()
      });
    }

    return resultados;

  } catch (e) {
    console.log("Erro scraping:", e.message);
    return null;
  }
}

// 🔁 ATUALIZA AUTOMÁTICO
setInterval(async () => {
  const dados = await buscarResultado();

  if (dados) {
    historico.push(...dados);

    // manter só últimos 7 dias
    const limite = new Date();
    limite.setDate(limite.getDate() - 7);

    historico = historico.filter(r => new Date(r.data) > limite);

    console.log("Atualizado histórico:", historico.length);
  }

}, 60000); // a cada 1 min

// 📊 API RESULTADO ATUAL
app.get("/api", async (req, res) => {
  const dados = await buscarResultado();

  if (!dados) {
    return res.json({
      status: "erro",
      motivo: "Falha no scraping"
    });
  }

  res.json({
    status: "ok",
    resultados: dados
  });
});

// 📚 HISTÓRICO
app.get("/historico", (req, res) => {
  res.json({
    total: historico.length,
    dados: historico
  });
});

// 📈 ANÁLISE 7 DIAS
app.get("/analise", (req, res) => {

  let freq = {};

  historico.forEach(r => {
    freq[r.dezena] = (freq[r.dezena] || 0) + 1;
  });

  let ranking = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  res.json({
    topDezenas: ranking
  });
});

// 🚀 RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
