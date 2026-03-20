const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

app.get("/api", async (req, res) => {
  try {
    const url = "https://www.resultadofacil.com.br/resultado-do-bicho/";

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "Connection": "keep-alive"
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    let resultados = [];

    const texto = $("body").text().replace(/\s+/g, " ");

    const milhares = texto.match(/\b\d{4}\b/g) || [];

    // 🔥 Validação forte
    if (milhares.length < 5) {
      console.log("⚠️ POSSÍVEL BLOQUEIO OU HTML DIFERENTE");

      return res.json({
        status: "erro",
        motivo: "Site mudou estrutura ou bloqueou scraping",
        encontrados: milhares.length
      });
    }

    // 🎯 Pega os 5 primeiros resultados
    for (let i = 0; i < 5; i++) {
      let milhar = milhares[i];

      resultados.push({
        premio: `${i + 1}º`,
        milhar: milhar,
        centena: milhar.slice(-3),
        dezena: milhar.slice(-2),
        grupo: Math.ceil(parseInt(milhar.slice(-2)) / 4)
      });
    }

    res.json({
      status: "ok",
      total: resultados.length,
      resultados
    });

  } catch (e) {
    console.log("🔥 ERRO REAL:", e.message);

    res.status(500).json({
      status: "erro",
      detalhe: e.message
    });
  }
});

// 🔥 ESSENCIAL PRA RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
