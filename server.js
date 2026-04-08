import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= FONTES =================
const fontes = [
  {
    nome: "principal",
    url: "https://bicho-api.onrender.com"
  },
  {
    nome: "proxy",
    url: "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com"
  }
];

// ================= VALIDAR DADOS =================
function dadosValidos(d) {
  if (!d) return false;

  const temDados =
    (d.rio && d.rio.length > 0) ||
    (d.look && d.look.length > 0) ||
    (d.nacional && d.nacional.length > 0) ||
    (d.federal && d.federal.length > 0);

  return temDados;
}

// ================= BUSCAR =================
async function buscarResultados() {
  for (let fonte of fontes) {
    try {
      const res = await axios.get(fonte.url, { timeout: 8000 });

      if (dadosValidos(res.data)) {
        console.log("✅ Fonte OK:", fonte.nome);

        return {
          fonte: fonte.nome,
          atualizado: new Date().toLocaleString(),
          ...res.data
        };
      }

      console.log("⚠️ Fonte sem dados:", fonte.nome);

    } catch (e) {
      console.log("❌ Falha:", fonte.nome);
    }
  }

  // fallback
  return {
    fonte: "offline",
    atualizado: new Date().toLocaleString(),
    rio: [],
    look: [],
    nacional: [],
    federal: []
  };
}

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  const dados = await buscarResultados();
  res.json(dados);
});

// ================= STATUS =================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    mensagem: "API rodando 🚀",
    endpoint: "/resultados"
  });
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Rodando na porta", PORT);
});