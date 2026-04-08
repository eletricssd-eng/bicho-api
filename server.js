import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= CACHE =================
let cache = null;
let tempo = 0;

// ================= PARSER =================
function organizarResultados(lista) {
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

// ================= FONTE PRINCIPAL =================
async function fontePrincipal() {
  try {
    const { data } = await axios.get("https://bicho-api.onrender.com", {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    return data;

  } catch {
    return null;
  }
}

// ================= SCRAPER FALLBACK =================
function limparNumeros(numeros) {
  return numeros.filter(n => {
    const num = parseInt(n);

    // remove anos e lixo comum
    if (num >= 2000 && num <= 2100) return false;

    // mantém apenas milhares válidas
    return n.length === 4;
  });
}

function agruparResultados(numeros) {
  let resultados = [];

  for (let i = 0; i < numeros.length; i += 5) {
    if (numeros[i + 4]) {
      resultados.push({
        horario: "extração",
        p1: numeros[i],
        p2: numeros[i + 1],
        p3: numeros[i + 2],
        p4: numeros[i + 3],
        p5: numeros[i + 4]
      });
    }
  }

  return resultados;
}

async function fallbackSimples(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    // pega números de 4 dígitos
    let numeros = data.match(/\d{4}/g) || [];

    // limpa lixo
    numeros = limparNumeros(numeros);

    // remove duplicados
    numeros = [...new Set(numeros)];

    // agrupa corretamente
    const resultados = agruparResultados(numeros);

    return resultados.slice(0, 10); // limita

  } catch (e) {
    console.log("Erro fallback:", e.message);
    return [];
  }
}
// ================= CARREGAR =================
async function carregarTudo() {
  const agora = Date.now();

  if (cache && agora - tempo < 60000) {
    console.log("⚡ cache");
    return cache;
  }

  console.log("🔄 atualizando...");

  const base = await fontePrincipal();

  let rio = organizarResultados(base?.rio || []);
  let look = organizarResultados(base?.look || []);
  let federal = organizarResultados(base?.federal || []);
  let nacional = organizarResultados(base?.nacional || []);

  // fallback se vazio
  if (rio.length === 0) {
    console.log("⚠️ fallback RIO");
    rio = await fallbackSimples("https://www.deunoposte.com/");
  }

  if (look.length === 0) {
    console.log("⚠️ fallback LOOK");
    look = await fallbackSimples("https://lookgoias.com/");
  }

  cache = {
    atualizado: new Date().toLocaleString(),
    rio,
    look,
    federal,
    nacional
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
    msg: "API PROFISSIONAL rodando 🚀",
    rota: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});