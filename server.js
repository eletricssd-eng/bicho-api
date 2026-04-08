import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= RIO =================
async function pegarRio() {
  try {
    const { data } = await axios.get("https://www.deunoposte.com/", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });

    const linhas = data.split("\n");
    let resultados = [];

    linhas.forEach(linha => {
      if (
        linha.includes("1º") &&
        linha.includes("2º") &&
        linha.includes("3º")
      ) {
        const nums = linha.match(/\d{4}/g);

        if (nums && nums.length >= 5) {
          resultados.push({
            horario: "PT",
            p1: nums[0],
            p2: nums[1],
            p3: nums[2],
            p4: nums[3],
            p5: nums[4]
          });
        }
      }
    });

    return resultados.slice(0, 5);

  } catch (e) {
    console.log("Erro Rio:", e.message);
    return [];
  }
}

// ================= LOOK GO =================
async function pegarLook() {
  try {
    const { data } = await axios.get("https://lookgoias.com/", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });

    const linhas = data.split("\n");
    let resultados = [];

    linhas.forEach(linha => {
      if (linha.includes("1º")) {
        const nums = linha.match(/\d{4}/g);

        if (nums && nums.length >= 5) {
          resultados.push({
            horario: "GO",
            p1: nums[0],
            p2: nums[1],
            p3: nums[2],
            p4: nums[3],
            p5: nums[4]
          });
        }
      }
    });

    return resultados.slice(0, 5);

  } catch (e) {
    console.log("Erro Look:", e.message);
    return [];
  }
}

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000
      }
    );

    const sorteio = data.listaSorteios?.[0];

    if (!sorteio) return [];

    return [{
      horario: "Federal",
      p1: sorteio.dezenas[0],
      p2: sorteio.dezenas[1],
      p3: sorteio.dezenas[2],
      p4: sorteio.dezenas[3],
      p5: sorteio.dezenas[4]
    }];

  } catch (e) {
    console.log("Erro Federal:", e.message);
    return [];
  }
}

// ================= CARREGAR TUDO =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ usando cache");
    return cache;
  }

  console.log("🔄 atualizando dados...");

  const [rio, look, federal] = await Promise.all([
    pegarRio(),
    pegarLook(),
    pegarFederal()
  ]);

  cache = {
    atualizado: new Date().toLocaleString(),
    rio,
    look,
    federal
  };

  tempo = agora;

  return cache;
}

// ================= ROTAS =================
app.get("/resultados", async (req, res) => {
  const dados = await carregarTudo();
  res.json(dados);
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    msg: "API REAL rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});