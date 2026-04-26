const API = "https://bicho-api.onrender.com/resultados";

let bancaAtual = "rio";
let diaSelecionado = 0;
let cacheAPI = null;
let cacheTempo = 0;

//////////////////////////////////////////////////
// 🚀 API (SEM LOGIN)
//////////////////////////////////////////////////

async function getDataCompleto(){

  const agora = Date.now();

  if(cacheAPI && (agora - cacheTempo < 60000)){
    return cacheAPI;
  }

  const res = await fetch(API);

  const json = await res.json();

  cacheAPI = json;
  cacheTempo = agora;

  return json;
}

//////////////////////////////////////////////////
// 🐾 BICHOS
//////////////////////////////////////////////////

const bichos = [
["01","🦩","Avestruz"],["02","🦅","Águia"],["03","🐴","Burro"],
["04","🦋","Borboleta"],["05","🐶","Cachorro"],["06","🐐","Cabra"],
["07","🐑","Carneiro"],["08","🐪","Camelo"],["09","🐍","Cobra"],
["10","🐰","Coelho"],["11","🐎","Cavalo"],["12","🐘","Elefante"],
["13","🐓","Galo"],["14","🐱","Gato"],["15","🐊","Jacaré"],
["16","🦁","Leão"],["17","🐒","Macaco"],["18","🐖","Porco"],
["19","🦚","Pavão"],["20","🦃","Peru"],["21","🐂","Touro"],
["22","🐅","Tigre"],["23","🐻","Urso"],["24","🦌","Veado"],
["25","🐄","Vaca"]
];

function extrairDezena(num){
  if(!num) return null;
  let str = String(num).replace(/\D/g,"");
  return str.slice(-2).padStart(2,"0");
}

function getGrupo(dez){
  if(dez==="00") return 25;
  return Math.ceil(Number(dez)/4);
}

function getBicho(dez){
  const g = getGrupo(dez);
  const b = bichos[g-1];
  return { grupo:g, emoji:b[1], nome:b[2] };
}

//////////////////////////////////////////////////
// 🚀 INIT
//////////////////////////////////////////////////

window.onload = ()=>{
  iniciarApp();
};

function iniciarApp(){
  renderBotoesBancas();
  renderTabela();
  abrir("home");
}

//////////////////////////////////////////////////
// 📊 TABELA
//////////////////////////////////////////////////

function renderTabela(){
  const tabela = document.getElementById("tabela");
  if(!tabela) return;

  tabela.innerHTML = bichos.map(b=>`
    <div class="bicho">
      <b>${b[0]}</b><br>${b[1]}<br>${b[2]}
    </div>
  `).join("");
}

//////////////////////////////////////////////////
// 🖥️ TELAS
//////////////////////////////////////////////////

function abrir(tela){

  document.querySelectorAll(".tela")
    .forEach(t=>t.style.display="none");

  document.getElementById(tela).style.display="block";

  const bancasBox = document.getElementById("bancasBox");

  bancasBox.style.display = (tela === "home") ? "none" : "flex";
}

function trocarTela(tela, btn){

  abrir(tela);

  document.querySelectorAll(".menu-btn")
    .forEach(b=>b.classList.remove("ativo"));

  if(btn) btn.classList.add("ativo");

  if(tela==="resultados") carregarResultados();
  if(tela==="analise") carregarAnalise();
  if(tela==="mapa") carregarMapa();
}

//////////////////////////////////////////////////
// 🏦 BANCAS
//////////////////////////////////////////////////

function renderBotoesBancas(){

  const box = document.getElementById("bancasBox");

  const bancas = ["rio","look","nacional","federal"];

  box.innerHTML = bancas.map(b=>`
    <button onclick="selecionarBanca('${b}')"
      style="background:${b===bancaAtual?'#2ecc71':'#555'};color:#fff;">
      ${b.toUpperCase()}
    </button>
  `).join("");
}

function selecionarBanca(b){
  bancaAtual=b;
  renderBotoesBancas();
  carregarResultados();
  carregarAnalise();
  carregarMapa(b, diaSelecionado);
}

//////////////////////////////////////////////////
// 📈 RESULTADOS
//////////////////////////////////////////////////

async function carregarResultados(){

  const box = document.getElementById("resultadosBox");
  box.innerHTML = "⏳";

  try{

    const json = await getDataCompleto();

    const datas = Object.keys(json.historico)
      .sort((a,b)=> new Date(b) - new Date(a));

    const hoje = datas[0];
    const dadosHoje = json.historico[hoje];

    let lista = dadosHoje[bancaAtual] || [];

    // FEDERAL
    if(bancaAtual === "federal"){
      lista = [];

      datas.forEach(d=>{
        lista.push(...(json.historico[d].federal || []));
      });

      lista = lista.slice(0,1);
    }

    if(lista.length === 0){
      box.innerHTML = "❌ Sem resultados";
      return;
    }

    const [ano,mes,dia] = hoje.split("-");
    const dataBR = `${dia}/${mes}/${ano}`;

    let html = `<div class="grid-5">`;

    html += lista.map(item=>{

      let hora = item.horario.match(/\d{1,2}:\d{2}/)?.[0] || "??:??";

      return `
        <div class="card">
          <b>${hora}</b><br>
          <small>${dataBR}</small><br><br>

          1º → <b>${item.p1}</b><br>
          2º → <b>${item.p2}</b><br>
          3º → <b>${item.p3}</b><br>
          4º → <b>${item.p4}</b><br>
          5º → <b>${item.p5}</b>
        </div>
      `;
    }).join("");

    html += `</div>`;

    box.innerHTML = html;

  }catch{
    box.innerHTML = "❌ erro ao carregar";
  }
}

//////////////////////////////////////////////////
// 📋 COPIAR
//////////////////////////////////////////////////

window.copiarTexto = function(texto){
  navigator.clipboard.writeText(texto)
    .then(()=> alert("✅ Copiado!"))
    .catch(()=> alert("❌ Erro"));
};