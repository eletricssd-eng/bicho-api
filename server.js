import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= FONTES POR BANCA =================
const FONTES = {
  rio: [
    "https://bicho-api.onrender.com/rio",
    "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com/rio"
  ],
  look: [
    "https://bicho-api.onrender.com/look",
    "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com/look"
  ],
  federal: [
    "https://bicho-api.onrender.com/federal",
    "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com/federal"
  ],
  geral: [
    "https://bicho-api.onrender.com",
    "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com"
  ]
};

// ================= VALIDAR =================
function valido(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

// ================= BUSCAR POR BANCA =================
async function buscarBanca(lista) {
  for (let url of lista) {
    try {
      const res = await axios.get(url, { timeout: 8000 });

      if (Array.isArray(res.data) && res.data.length > 0) {
        console.log("✅ OK:", url);
        return res.data;
      }

      if (res.data && typeof res.data === "object") {
        return res.data;
      }

    } catch {
      console.log("❌ erro:", url);
    }
  }
  return [];
}

// ================= BUSCAR GERAL =================
async function buscarGeral() {
  for (let url of FONTES.geral) {
    try {
      const res = await axios.get(url, { timeout: 8000 });

      if (res.data && Object.keys(res.data).length > 0) {
        return res.data;
      }

    } catch {}
  }
  return null;
}

// ================= CACHE =================
let cache = null;
let tempo = 0;

async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ cache");
    return cache;
  }

  console.log("🔄 atualizando...");

  const [rio, look, federal, geral] = await Promise.all([
    buscarBanca(FONTES.rio),
    buscarBanca(FONTES.look),
    buscarBanca(FONTES.federal),
    buscarGeral()
  ]);

  const resultado = {
    atualizado: new Date().toLocaleString(),
    fonte: "multi-fontes",

    rio: valido(rio) ? rio : (geral?.rio || []),
    look: valido(look) ? look : (geral?.look || []),
    federal: valido(federal) ? federal : (geral?.federal || []),
    nacional: geral?.nacional || []
  };

  cache = resultado;
  tempo = agora;

  return resultado;
}

// ================= ROTAS =================
app.get("/resultados", async (req, res) => {
  const dados = await carregarTudo();
  res.json(dados);
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    msg: "API multi-bancas rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Porta", PORT);
});