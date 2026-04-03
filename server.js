import express from "express";
import axios from "axios";
import cors from "cors";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import cron from "node-cron";

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

// ================= CAMINHO JSON =================
const caminho = path.join(__dirname, "dados.json");

// ================= SALVAR HISTÓRICO =================
function salvarHistorico(novosDados) {
  let antigos = [];

  try {
    antigos = JSON.parse(fs.readFileSync(caminho, "utf-8"));
  } catch {}

  const hoje = new Date().toISOString().split("T")[0];

  novosDados.forEach(d => d.data = hoje);

  const combinado = [...antigos, ...novosDados];

  // manter só últimos 7 dias
  const limite = new Date();
  limite.setDate(limite.getDate() - 7);

  const filtrado = combinado.filter(d => new Date(d.data) >= limite);

  fs.writeFileSync(caminho, JSON.stringify(filtrado, null, 2));

  console.log("💾 Histórico atualizado");
}

// ================= ANALISE =================
function analisar(dados) {
  let contagem = {};

  dados.forEach(d => {
    d.resultados.forEach(r => {
      const bicho = r.bicho || "desconhecido";
      contagem[bicho] = (contagem[bicho] || 0) + 1;
    });
  });

  const ordenado = Object.entries(contagem)
    .sort((a, b) => b[1] - a[1]);

  return {
    mais_fortes: ordenado.slice(0, 3),
    menos_frequentes: ordenado.slice(-3)
  };
}

// ================= LEITURA LOCAL =================
async function pegarResultadosSeguro() {
  try {
    const dados = JSON.parse(fs.readFileSync(caminho, "utf-8"));

    if (dados.length > 0) {
      return { fonte: "auto", dados };
    }

  } catch (err) {
    console.log("❌ ERRO JSON:", err.message);
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

// ================= CRON (AUTOMAÇÃO) =================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏰ Atualizando dados automaticamente...");

  try {
    // 🔥 AQUI você pode depois trocar por API real
    const novos = JSON.parse(fs.readFileSync(caminho, "utf-8"));

    if (novos.length > 0) {
      salvarHistorico(novos);
    }

  } catch (err) {
    console.log("❌ ERRO CRON:", err.message);
  }
});

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  try {
    const resposta = await pegarResultadosSeguro();
    const dados = resposta.dados;

    const separado = separar(dados);
    const analise = analisar(dados);

    res.json({
      fonte: resposta.fonte,
      ...separado,
      analise
    });

  } catch (err) {
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