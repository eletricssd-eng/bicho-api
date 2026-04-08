import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const YT_KEY = "AIzaSyAGQ1mYfOxWm97S90nR0Hew-ukg3VdU4vE";

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= API BASE =================
async function fonteAPI() {
  try {
    const { data } = await axios.get("https://bicho-api.onrender.com", {
      timeout: 5000
    });
    return data;
  } catch {
    return null;
  }
}

// ================= SCRAPER SIMPLES =================
async function scraperSimples(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const nums = data.match(/\d{4}/g) || [];

    if (nums.length < 5) return [];

    return [{
      horario: "extração",
      p1: nums[0],
      p2: nums[1],
      p3: nums[2],
      p4: nums[3],
      p5: nums[4]
    }];

  } catch {
    return [];
  }
}

// ================= YOUTUBE =================
async function buscarYouTube() {
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          part: "snippet",
          q: "resultado jogo do bicho hoje rio goias federal",
          maxResults: 5,
          key: YT_KEY
        }
      }
    );

    return res.data.items;

  } catch (e) {
    console.log("Erro YouTube:", e.message);
    return [];
  }
}

function extrairResultados(texto) {
  const nums = texto.match(/\d{4}/g) || [];

  if (nums.length < 5) return null;

  return {
    horario: "YouTube",
    p1: nums[0],
    p2: nums[1],
    p3: nums[2],
    p4: nums[3],
    p5: nums[4]
  };
}

async function pegarYouTube() {
  const videos = await buscarYouTube();

  for (let v of videos) {
    const titulo = v.snippet.title;

    const resultado = extrairResultados(titulo);

    if (resultado) {
      console.log("✅ YouTube:", titulo);
      return [resultado];
    }
  }

  return [];
}

// ================= ORGANIZAR =================
function organizar(lista) {
  if (!Array.isArray(lista)) return [];

  return lista.map(item => ({
    horario: item.horario || item.nome || "N/D",
    p1: item.p1 || item["1"] || "-",
    p2: item.p2 || item["2"] || "-",
    p3: item.p3 || item["3"] || "-",
    p4: item.p4 || item["4"] || "-",
    p5: item.p5 || item["5"] || "-"
  }));
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ cache");
    return cache;
  }

  console.log("🔄 atualizando...");

  // 1️⃣ API
  const base = await fonteAPI();

  let rio = organizar(base?.rio || []);
  let look = organizar(base?.look || []);
  let federal = organizar(base?.federal || []);

  // 2️⃣ SCRAPER fallback
  if (rio.length === 0) {
    console.log("🔴 fallback scraper RIO");
    rio = await scraperSimples("https://www.deunoposte.com/");
  }

  if (look.length === 0) {
    console.log("🟡 fallback scraper LOOK");
    look = await scraperSimples("https://lookgoias.com/");
  }

  // 3️⃣ YOUTUBE fallback FINAL
  if (rio.length === 0) {
    console.log("🔴 fallback YouTube RIO");
    rio = await pegarYouTube();
  }

  if (look.length === 0) {
    console.log("🟡 fallback YouTube LOOK");
    look = await pegarYouTube();
  }

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
    msg: "API COMPLETA rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});