import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const YT_KEY = "AIzaSyAGQ1mYfOxWm97S90nR0Hew-ukg3VdU4vE";

// ================= CANAL BOM PALPITE =================
const canais = [
  "UC0cRrQj7hX9r0x0d9wq0R8A"
];

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= FILTRO =================
function numerosValidos(nums) {
  return nums.filter(n => {
    const num = parseInt(n);

    if (num >= 2000 && num <= 2100) return false;
    if (/^(\d)\1{3}$/.test(n)) return false;

    return true;
  });
}

// ================= SCRAPER LOOK =================
async function scraperSimples(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    let nums = data.match(/\d{4}/g) || [];

    nums = numerosValidos(nums);
    nums = [...new Set(nums)];

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

// ================= FEDERAL =================
async function pegarFederal() {
  try {
    const { data } = await axios.get(
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
      {
        headers: { "User-Agent": "Mozilla/5.0" }
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

// ================= YOUTUBE POR CANAL =================
async function buscarPorCanal(channelId) {
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          part: "snippet",
          channelId: channelId,
          order: "date",
          maxResults: 10,
          key: YT_KEY
        }
      }
    );

    return res.data.items;

  } catch (e) {
    console.log("Erro canal:", e.message);
    return [];
  }
}

// ================= EXTRAÇÃO =================
function extrairResultados(texto) {
  let nums = texto.match(/\d{4}/g) || [];

  nums = numerosValidos(nums);

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

// ================= PEGAR RESULTADO YOUTUBE =================
async function pegarYouTube() {
  for (let canal of canais) {
    const videos = await buscarPorCanal(canal);

    for (let v of videos) {
      const titulo = v.snippet.title;
      const descricao = v.snippet.description || "";

      const texto = titulo + " " + descricao;

      console.log("🔎 título:", titulo);

      const resultado = extrairResultados(texto);

      if (resultado) {
        console.log("✅ BOM PALPITE OK");
        return [resultado];
      }
    }
  }

  return [];
}

// ================= PRINCIPAL =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ cache");
    return cache;
  }

  console.log("🔄 atualizando...");

  // LOOK
  let look = await scraperSimples("https://lookgoias.com/");

  // RIO (YouTube canal)
  let rio = await pegarYouTube();

  // FEDERAL
  let federal = await pegarFederal();

  // fallback LOOK
  if (look.length === 0 || look[0]?.p1 === "2025") {
    console.log("⚠️ fallback YouTube LOOK");
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
    msg: "API rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});