import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const YT_KEY = "SUA_API_KEY_AQUI"; // ⚠️ troque sua chave

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

// ================= SCRAPER =================
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

  // API
  const base = await fonteAPI();

  let rio = organizar(base?.rio || []);
  let look = organizar(base?.look || []);

  // FEDERAL DIRETO
  let federal = await pegarFederal();

  // SCRAPER fallback
  if (look.length === 0) {
    console.log("🟡 fallback scraper LOOK");
    look = await scraperSimples("https://lookgoias.com/");
  }

  // 🔥 RIO DIRETO DO YOUTUBE (mais confiável)
  console.log("🔴 usando YouTube como fonte RIO");
  rio = await pegarYouTube();

  // fallback extra se LOOK vier lixo
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
    msg: "API COMPLETA rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});