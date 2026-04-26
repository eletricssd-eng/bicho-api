const API = "https://bicho-api.onrender.com/resultados";

let bancaAtual = "rio";
let diaSelecionado = 0;
let cacheAPI = null;
let cacheTempo = 0;

// ================= BICHOS =================
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

// ================= FUNÇÕES =================
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

// ================= API =================
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

// ================= INIT =================
function iniciarApp(){
  renderBotoesBancas();
  renderTabela();
  abrir("home");
}

// ================= TABELA =================
function renderTabela(){
  const tabela = document.getElementById("tabela");
  if(!tabela) return;

  tabela.innerHTML = bichos.map(b=>`
    <div class="bicho">
      <b>${b[0]}</b><br>${b[1]}<br>${b[2]}
    </div>
  `).join("");
}

// ================= TELAS =================
function abrir(tela){

  document.querySelectorAll(".tela")
    .forEach(t=>t.style.display="none");

  document.getElementById(tela).style.display="block";

  const bancasBox = document.getElementById("bancasBox");

  if(tela === "home"){
    bancasBox.style.display = "none";
  }else{
    bancasBox.style.display = "flex";
  }
}

// ================= MENU =================
function trocarTela(tela, btn){

  abrir(tela);

  document.querySelectorAll(".menu-btn")
    .forEach(b=>b.classList.remove("ativo"));

  if(btn) btn.classList.add("ativo");

  if(tela==="resultados") carregarResultados();
  if(tela==="analise") carregarAnalise();
  if(tela==="mapa") carregarMapa();
}

// ================= BANCAS =================
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

// ================= RESULTADOS =================
async function carregarResultados(){

  const box = document.getElementById("resultadosBox");
  box.innerHTML = "⏳";

  try{

    const json = await getDataCompleto();

    if(!json || !json.historico){
      box.innerHTML = "❌ Sem dados";
      return;
    }

    const datas = Object.keys(json.historico)
      .sort((a,b)=> new Date(b) - new Date(a));

    const hoje = datas[0];
    const dadosHoje = json.historico[hoje];

    let lista = dadosHoje?.[bancaAtual] || [];

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

    let html = `
  <div style="
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:10px;
  ">
`;

    html += lista.map(item=>{

      let horaMatch = item.horario.match(/\d{1,2}:\d{2}/);
      let hora = horaMatch ? horaMatch[0] : "??:??";

      if(!horaMatch){
        let h = item.horario.match(/\d{1,2}h/);
        if(h) hora = h[0].replace("h",":00");
      }

      return `
        <div class="card">
          <b>${hora}</b><br><small>${dataBR}</small><br><br>
          1º ${item.p1}<br>
          2º ${item.p2}<br>
          3º ${item.p3}<br>
          4º ${item.p4}<br>
          5º ${item.p5}
        </div>
      `;
    }).join("");

    html += `</div>`;
    box.innerHTML = html;

  }catch{
    box.innerHTML = "❌ Erro";
  }
}

// ================= ANALISE =================
async function carregarAnalise(){

  const box = document.getElementById("analiseBox");
  box.innerHTML="⏳";

  const json = await getDataCompleto();

  if(!json || !json.historico){
    box.innerHTML = "❌ Sem dados";
    return;
  }

  const datas = Object.keys(json.historico)
    .sort((a,b)=> new Date(b) - new Date(a))
    .slice(0,7);

  let freq = {};

  bichos.forEach((b,i)=>{
    const g=i+1;
    freq[g]={};
    for(let i2=1;i2<=4;i2++){
      let dez=(g-1)*4+i2;
      if(g===25 && i2===4) dez=0;
      dez=String(dez).padStart(2,"0");
      freq[g][dez]=0;
    }
  });

  datas.forEach(d=>{
    const lista = json.historico[d]?.[bancaAtual]||[];
    lista.forEach(item=>{
      [item.p1,item.p2,item.p3,item.p4,item.p5].forEach(n=>{
        const dez=extrairDezena(n);
        const g=getGrupo(dez);
        if(freq[g] && freq[g][dez]!=undefined){
          freq[g][dez]++;
        }
      });
    });
  });

  box.innerHTML = `
    <div class="grid-5">
      ${bichos.map((b,i)=>{
        const g=i+1;
        return `<div class="card">${b[1]}<br>${
          Object.entries(freq[g]).map(d=>`${d[0]}:${d[1]}`).join("<br>")
        }</div>`;
      }).join("")}
    </div>
  `;
}

// ================= MAPA =================
function renderBotoesMapa(){

  const box = document.getElementById("mapaBotoes");

  box.innerHTML = [0,1,2,3,4,5,6].map(d=>`
    <button onclick="carregarMapa('${bancaAtual}',${d})"
      style="background:${d===diaSelecionado?'#333':'#ddd'};">
      ${d===0?"Hoje":"Dia "+(d+1)}
    </button>
  `).join("");
}

async function carregarMapa(banca="rio", dia=0){

  bancaAtual = banca;
  diaSelecionado = dia;

  renderBotoesMapa();

  const box = document.getElementById("mapaGrid");
  box.innerHTML = "⏳";

  const json = await getDataCompleto();

  if(!json || !json.historico){
    box.innerHTML = "❌ Sem dados";
    return;
  }

  const datas = Object.keys(json.historico)
    .sort((a,b)=> new Date(b)-new Date(a));

  let dados = json.historico[datas[dia]]?.[bancaAtual] || [];

  let freq = {};
  bichos.forEach(b => freq[b[1]] = 0);

  dados.forEach(i=>{
    const dez = extrairDezena(i.p1);
    if(!dez) return;
    const b = getBicho(dez);
    freq[b.emoji]++;
  });

  const cor = v=>{
    if(v>=3) return "#ff4d4d";
    if(v==2) return "#ffd54f";
    if(v==1) return "#a5d6a7";
    return "#eee";
  };

  box.innerHTML = `
    <div class="grid-5">
      ${bichos.map(b=>{
        const v = freq[b[1]];
        return `<div style="background:${cor(v)};padding:10px;border-radius:10px;text-align:center;">
          ${b[1]}<br><b>${v}x</b>
        </div>`;
      }).join("")}
    </div>
  `;
}

// ================= PALPITE =================
async function carregarPalpite(banca = bancaAtual){

  const box = document.getElementById("palpiteBox");
  box.innerHTML = "⏳ gerando palpites...";

  try{

    const json = await getDataCompleto();

    if(!json || !json.historico){
      box.innerHTML = "❌ dados inválidos da API";
      return;
    }

    const historico = json.historico;

    const datas = Object.keys(historico)
      .sort((a,b)=> new Date(b) - new Date(a))
      .slice(0,7);

    let grupos={}, dezenas={}, centenas={}, milhares={};

    datas.forEach(d=>{

      const lista = historico[d]?.[banca] || [];

      lista.forEach(item=>{

        [item.p1,item.p2,item.p3,item.p4,item.p5].forEach(num=>{

          if(!num) return;

          let n = String(num).padStart(4,"0");

          const dez = n.slice(-2);
          const cen = n.slice(-3);
          const mil = n;

          dezenas[dez]=(dezenas[dez]||0)+1;
          centenas[cen]=(centenas[cen]||0)+1;
          milhares[mil]=(milhares[mil]||0)+1;

          const grupo = (dez === "00") ? 25 : Math.ceil(parseInt(dez)/4);
          grupos[grupo]=(grupos[grupo]||0)+1;

        });

      });

    });

    // 🔥 pega TOP
    const top = (obj,n)=>
      Object.entries(obj)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,n)
        .map(i=>i[0]);

    const gTop = top(grupos,3);
    const dTop = top(dezenas,3);
    const cTop = top(centenas,3);
    const mTop = top(milhares,3);

    // 🔥 DUQUE
    const duque = (arr)=>{
      let out=[];
      for(let i=0;i<arr.length;i++){
        for(let j=i+1;j<arr.length;j++){
          out.push(`${arr[i]}-${arr[j]}`);
        }
      }
      return out;
    };

    // 🔥 TERNO
    const terno = (arr)=>{
      if(arr.length < 3) return [];
      return [`${arr[0]}-${arr[1]}-${arr[2]}`];
    };

    // 🔥 CARD PADRÃO
    function card(titulo, valor){

  const texto = valor.length ? valor.join(" | ") : "-";

  return `
    <div class="card" style="
      padding:12px;
      text-align:center;
    ">

      <b>${titulo}</b>

      <div style="margin:10px 0; font-size:14px;">
        ${valor.join("<br>")}
      </div>

      <button onclick="copiarTexto('${texto}')"
        style="
          background:#222;
          color:#fff;
          border:none;
          border-radius:6px;
          padding:6px 10px;
          width:100%;
          margin-top:8px;
        ">
        copiar
      </button>

    </div>
  `;
}

    // 🔥 GRID BONITO
    box.innerHTML = `
  <div style="
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:10px;
  ">

    ${card("Grupo", gTop)}
    ${card("Dezena", dTop)}
    ${card("Centena", cTop)}
    ${card("Milhar", mTop)}

    ${card("Duque Grupo", duque(gTop))}
    ${card("Duque Dezena", duque(dTop))}

    ${card("Terno Grupo", terno(gTop))}
    ${card("Terno Dezena", terno(dTop))}

  </div>
`;

  }catch(e){
    console.error(e);
    box.innerHTML = "❌ erro ao gerar palpite";
  }
}

// ================= INIT =================
window.onload = ()=>{
  iniciarApp();
};
window.gerarPalpite = function(){
  carregarPalpite(bancaAtual);
};
window.copiarTexto = function(texto){
  navigator.clipboard.writeText(texto)
    .then(()=> alert("✅ Copiado!"))
    .catch(()=> alert("❌ Erro ao copiar"));
};