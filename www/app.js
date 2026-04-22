document.addEventListener("DOMContentLoaded", () => {

  const API = "https://bicho-api.onrender.com/resultados";

  async function carregarResultados() {
    const el = document.getElementById("resultado");

    try {
      el.innerHTML = "Carregando...";

      const res = await fetch(API);
      const data = await res.json();

      const hoje = Object.keys(data.historico).pop();
      const dia = data.historico[hoje];

      let html = `<h2>📅 ${hoje}</h2>`;

      for (let banca in dia) {
        if (!dia[banca].length) continue;

        html += `<h3 style="color:yellow">${banca.toUpperCase()}</h3>`;

        dia[banca].forEach(r => {
          html += `
            <div style="margin-bottom:10px;">
              🕐 ${r.horario}<br>
              ${r.p1} - ${r.p2} - ${r.p3} - ${r.p4} - ${r.p5}
            </div>
          `;
        });
      }

      el.innerHTML = html;

    } catch (erro) {
      el.innerHTML = "Erro ao carregar 😢";
      console.log(erro);
    }
  }

  carregarResultados();

});