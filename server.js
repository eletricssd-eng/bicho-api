import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = 3000;

// ================= FUNÇÃO BUSCAR RESULTADOS =================
async function buscarResultados() {
  try {
    // API pública (ajuste se necessário)
    const res = await axios.get("https://bicho-api.onrender.com");

    const dados = res.data;

    return {
      fonte: "api-publica",
      rio: dados.rio || [],
      look: dados.look || [],
      nacional: dados.nacional || [],
      federal: dados.federal || []
    };

  } catch (erro) {
    console.log("Erro API:", erro.message);

    return {
      fonte: "fallback",
      rio: [],
      look: [],
      nacional: [],
      federal: []
    };
  }
}

// ================= ROTA =================
app.get("/resultados", async (req, res) => {
  const dados = await buscarResultados();
  res.json(dados);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Servidor rodando em http://localhost:" + PORT);
});