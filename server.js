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
        "User-Agent": "Mozilla/5.0 (Windows
          NT 10.0; Win64; x64)",
        "Accept": "text/html,application/xhtml+xml"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    let resultados = [];

    const texto = $("body").text();

    const milhares = texto.match(/\d{4}\b/g) || [];

    if (milhares.length < 5) {
      console.log("HTML recebido:",
                  texto.substring(0,500)); // debug
      
      return res.json({
        status: "erro",
        motivo: "Site mudou ou bloqueou scraping"
      });
    }

    for (let i = 0; i < 5; i++) {
      let milhar = milhares[i];

      resultados.push({
        premio: `${i + 1}º`,
        milhar: milhar,
        dezena: milhar.slice(-2)
      });
    }

    res.json({
      status: "ok",
      resultados
    });

  } catch (e) {
    console.log("ERRO REAL:", e.message);
    console.log(e);

    res.json({
      status: "erro",
      detalhe: e.message
    });
  }
});

// 🔥 ESSENCIAL PRO RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
