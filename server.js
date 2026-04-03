import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const __dirname = new URL('.', import.meta.url).pathname;

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= ORDEM =================
const ORDEM = ["09", "10", "11", "12", "14", "15", "16", "18", "19", "21"];

function ordenar(lista) {
  return lista.sort((a, b) =>
    ORDEM.indexOf(a.horario?.slice(0, 2)) -
    ORDEM.indexOf(b.horario?.slice(0, 2))
  );
}

// ================= CACHE =================
let cache = null;
let ultimaAtualizacao = 0;
const TEMPO_CACHE = 60000;

// ================= NORMALIZAR =================
function normalizar(data) {
  if (!Array.isArray(data)) return [];

  return data.map(item => ({
    banca: item.bank?.toLowerCase() || item.banca || "",
    horario: item.time || item.horario || "",
    resultados: (item.results || item.resultados || []).map(r => ({
      pos: r.position || r.pos,
      numero: r.number || r.numero,
      bicho: r.animal || r.bicho || ""
    }))
  }));
}

// ================= API =================
async function pegarViaAPI() {
  try {
    console.log("🔍 Buscando API alternativa...");

    const { data } = await axios.get(
      "https://loteriascaixa-api.herokuapp.com/api/jogo-do-bicho",
      { timeout: 10000 }
    );

    if (!data || data.length === 0) return [];

    const resultados = data.map(item => ({
      banca: item.banca?.toLowerCase() || "geral",
      horario: item.horario || "",
      resultados: [
        {
          pos: "1",
          numero: item.dezena || "",
          bicho: item.bicho || ""
        }
      ]
    }));

    console.log("✅ API alternativa OK");
    return resultados;

  } catch (err) {
    console.log("❌ API alternativa falhou:", err.message);
    return [];
  }
}
// ================= SCRAPING PRO =================
async function pegarViaScraping() {
  try {
    console.log("🌐 Scraping direto funcional...");

    const { data: html } = await axios.get(
      "https://api.allorigins.win/raw?url=https://resultadofacil.com.br/resultado-do-jogo-do-bicho/",
      { timeout: 10000 }
    );

    const $ = cheerio.load(html);

    let lista = [];

    $("table tr").each((i, el) => {
      const colunas = $(el).find("td");

      if (colunas.length >= 2) {
        const pos = $(colunas[0]).text().trim();
        const numero = $(colunas[1]).text().trim();

        if (numero.match(/\d{4}/)) {
          lista.push({
            banca: "rio",
            horario: "",
            resultados: [{
              pos,
              numero,
              bicho: ""
            }]
          });
        }
      }
    });

    if (lista.length > 0) {
      console.log("✅ SCRAPING FUNCIONOU DE VERDADE");
      return lista;
    }

  } catch (err) {
    console.log("❌ ERRO SCRAPING:", err.message);
  }

  return [];
}
// ================= FALLBACK =================
async function pegarResultadosSeguro() {
  try {
    console.log("📂 Lendo dados locais...");

    const caminho = path.join(__dirname, "dados.json");

    const dados = JSON.parse(fs.readFileSync(caminho, "utf-8"));

    if (dados.length > 0) {
      console.log("✅ DADOS LOCAIS OK");
      return { fonte: "local", dados };
    }

  } catch (err) {
    console.log("❌ ERRO AO LER JSON:", err.message);
  }

  return { fonte: "mock", dados: [] };
}

// ================= FILTRAR =================
function separar(dados) {
  return {
    rio: dados,
    nacional: dados,
    look: dados,
    federal: dados
  };
}

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  try {
    const agora = Date.now();

    if (cache && agora - ultimaAtualizacao < TEMPO_CACHE) {
      return res.json(cache);
    }

    const resposta = await pegarResultadosSeguro();
    const dados = resposta.dados;

    console.log("📊 Fonte:", resposta.fonte);

    const separado = separar(dados);

    separado.rio = ordenar(separado.rio);
    separado.nacional = ordenar(separado.nacional);
    separado.look = ordenar(separado.look);
    separado.federal = ordenar(separado.federal);

    const final = {
      fonte: resposta.fonte,
      ...separado
    };

    cache = final;
    ultimaAtualizacao = agora;

    res.json(final);

  } catch (err) {
    console.log("🔥 ERRO GERAL:", err.message);
    res.status(500).json({ erro: "Falha na API" });
  }
});

// ================= TESTE =================
app.get("/", (req, res) => {
  res.send("API ONLINE 🚀");
});

// ================= START =================
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Rodando na porta " + PORT);
});