document.addEventListener("DOMContentLoaded", () => {

  const API = "https://bicho-api.onrender.com/resultados";

  async function carregarResultados() {
    const el = document.getElementById("resultado");

    try {
      el.innerHTML = "Carregando dados...";

      const res = await fetch(API);
      const texto = await res.text(); // evita erro silencioso

      el.innerHTML = texto;

    } catch (erro) {
      el.innerHTML = "Erro ao carregar 😢";
      console.log("ERRO:", erro);
    }
  }

  carregarResultados();

});