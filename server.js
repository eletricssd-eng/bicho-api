import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= MULTI FONTES =================
const fontes = [
  "https://bicho-api.onrender.com",
  "https://api.allorigins.win/raw?url=https://bicho-api.onrender.com"
];

// ================= BUSCAR =================
async function buscarResultados() {
  for (let url of fontes) {
    try {
      const res = await axios.get(url, { timeout: 5000 });

      if (res.data && Object.keys(res.data).length > 0) {
        console.log("Fonte OK:", url);

        return {
          fonte: url,
          ...res.data
        };
      }

    } catch (e) {
      console.log("Falha:", url);
    }
  }

  return {
    fonte: "offline",
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

// ================= KEEP ALIVE =================
app.get("/", (req, res) => {
  res.send("API rodando 🚀");
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Rodando na porta", PORT);
});