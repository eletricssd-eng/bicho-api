const API = "https://bicho-api.onrender.com/resultados";

let bancaAtual = "rio";
let diaSelecionado = 0;
let cacheAPI = null;
let cacheTempo = 0;

// ================= LOGIN =================
let usuarioAtual = null;

function getUsers(){
  return JSON.parse(localStorage.getItem("users") || "[]");
}

function salvarUsers(users){
  localStorage.setItem("users", JSON.stringify(users));
}

function cadastrar(usuario, senha){

  let users = getUsers();

  if(!usuario || !senha){
    alert("Preencha usuário e senha");
    return;
  }

  if(users.find(u => u.usuario === usuario)){
    alert("Usuário já existe");
    return;
  }

  users.push({
    usuario,
    senha: btoa(senha)
  });

  salvarUsers(users);

  alert("Cadastro realizado!");
}

function login(usuario, senha){

  let users = getUsers();

  let user = users.find(u =>
    u.usuario === usuario &&
    u.senha === btoa(senha)
  );

  if(!user){
    alert("Login inválido");
    return;
  }

  usuarioAtual = usuario;

  localStorage.setItem("sessao", usuario);
  localStorage.setItem("ultimoUsuario", usuario);
  localStorage.setItem("ultimaSenha", senha);

  iniciarApp();
}

function verificarSessao(){

  const sessao = localStorage.getItem("sessao");

  if(sessao){
    usuarioAtual = sessao;
    return true;
  }

  return false;
}

function logout(){

  usuarioAtual = null;

  localStorage.removeItem("sessao");

  location.reload();
}
//////////////////////////////////////////////////
// PREENCHER LOGIN AUTOMÁTICO
//////////////////////////////////////////////////

function carregarUltimoLogin(){

  const ultimoUsuario = localStorage.getItem("ultimoUsuario");
  const ultimaSenha = localStorage.getItem("ultimaSenha");

  if(document.getElementById("usuario")){
    document.getElementById("usuario").value = ultimoUsuario || "";
  }

  if(document.getElementById("senha")){
    document.getElementById("senha").value = ultimaSenha || "";
  }
}
// ================= BICHOS =================
const bichos = [
["01","🦩","Avestruz"],
["02","🦅","Águia"],
["03","🐴","Burro"],
["04","🦋","Borboleta"],
["05","🐶","Cachorro"],
["06","🐐","Cabra"],
["07","🐑","Carneiro"],
["08","🐪","Camelo"],
["09","🐍","Cobra"],
["10","🐰","Coelho"],
["11","🐎","Cavalo"],
["12","🐘","Elefante"],
["13","🐓","Galo"],
["14","🐱","Gato"],
["15","🐊","Jacaré"],
["16","🦁","Leão"],
["17","🐒","Macaco"],
["18","🐖","Porco"],
["19","🦚","Pavão"],
["20","🦃","Peru"],
["21","🐂","Touro"],
["22","🐅","Tigre"],
["23","🐻","Urso"],
["24","🦌","Veado"],
["25","🐄","Vaca"]
];

// ================= FUNÇÕES =================
function extrairDezena(num){

  if(!num) return null;

  let str = String(num).replace(/\D/g,"");

  return str.slice(-2).padStart(2,"0");
}

function getGrupo(dez){

  if(dez === "00") return 25;

  return Math.ceil(Number(dez)/4);
}

function getBicho(dez){

  const g = getGrupo(dez);

  const b = bichos[g-1];

  return {
    grupo:g,
    emoji:b[1],
    nome:b[2]
  };
}

// ================= GRID HELPERS =================
function getlinha(grupo){

  if(grupo <= 5) return 1;
  if(grupo <= 10) return 2;
  if(grupo <= 15) return 3;
  if(grupo <= 20) return 4;

  return 5;
}

function getcoluna(grupo){

  let resto = grupo % 5;

  if(resto === 0) return 5;

  return resto;
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

  const login = document.getElementById("login");
  const app = document.getElementById("app");

  if(login) login.style.display = "none";

  if(app) app.style.display = "block";

  const userInfo = document.getElementById("userInfo");

  if(userInfo){
    userInfo.innerHTML = "👤 " + usuarioAtual;
  }

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
      <b>${b[0]}</b><br>
      ${b[1]}<br>
      ${b[2]}
    </div>
  `).join("");
}

// ================= TELAS =================
function abrir(tela){

  document.querySelectorAll(".tela")
    .forEach(t => t.style.display = "none");

  document.getElementById(tela).style.display = "block";

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
    .forEach(b => b.classList.remove("ativo"));

  if(btn) btn.classList.add("ativo");

  if(tela === "resultados") carregarResultados();

  if(tela === "analise") carregarAnalise();

  if(tela === "mapa") carregarMapa();

  if(tela === "palpite") carregarPalpite();
}

// ================= BANCAS =================
function renderBotoesBancas(){

  const box = document.getElementById("bancasBox");

  const bancas = [
    "rio",
    "look",
    "nacional",
    "federal"
  ];

  box.innerHTML = bancas.map(b=>`
    <button
      onclick="selecionarBanca('${b}')"
      style="
        background:${b===bancaAtual ? '#2ecc71' : '#555'};
        color:#fff;
      "
    >
      ${b.toUpperCase()}
    </button>
  `).join("");
}

function selecionarBanca(b){

  bancaAtual = b;

  renderBotoesBancas();

  carregarResultados();

  carregarAnalise();

  carregarMapa(b, diaSelecionado);

  carregarPalpite(b);
}

// ================= HORÁRIO =================
function extrairHorario(texto){

  if(!texto) return "Sem horário";

  texto = String(texto);

  let horaMatch =
    texto.match(/\d{1,2}:\d{2}/);

  if(horaMatch){
    return horaMatch[0];
  }

  let h =
    texto.match(/\d{1,2}h/);

  if(h){
    return h[0].replace("h",":00");
  }

  return texto;
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
      .sort((a,b)=> new Date(b)-new Date(a));

    let lista = [];
    let dataResultado = null;

    // ================= FEDERAL =================
    if(bancaAtual === "federal"){

      for(const d of datas){

        const arr =
          json.historico[d]?.federal || [];

        if(arr.length){

          lista = [arr[0]];

          dataResultado = d;

          break;
        }
      }

    }else{

      for(const d of datas){

        const arr =
          json.historico[d]?.[bancaAtual] || [];

        if(arr.length){

          lista = arr;

          dataResultado = d;

          break;
        }
      }
    }

    if(!lista.length){

      box.innerHTML = "❌ Sem resultados";

      return;
    }

    const [ano,mes,dia] =
      dataResultado.split("-");

    const dataBR =
      `${dia}/${mes}/${ano}`;

    let html = `
      <div style="
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:10px;
      ">
    `;

    html += lista.map(item=>{

      const hora =
        extrairHorario(item.horario);

      return `
        <div class="card">

          <b>${hora}</b><br>

          <small>${dataBR}</small><br><br>

          1º ${item.p1 || "--"}<br>
          2º ${item.p2 || "--"}<br>
          3º ${item.p3 || "--"}<br>
          4º ${item.p4 || "--"}<br>
          5º ${item.p5 || "--"}

        </div>
      `;

    }).join("");

    html += `</div>`;

    box.innerHTML = html;

  }catch(e){

    console.error(e);

    box.innerHTML = "❌ erro";
  }
}

// ================= ANALISE =================
async function carregarAnalise(){

  const box = document.getElementById("analiseBox");

  box.innerHTML = "⏳";

  const json = await getDataCompleto();

  if(!json || !json.historico){
    box.innerHTML = "❌ Sem dados";
    return;
  }

  const datas = Object.keys(json.historico)
    .sort((a,b)=> new Date(b)-new Date(a))
    .slice(0,7);

  let freq = {};

  bichos.forEach((b,i)=>{

    const g = i+1;

    freq[g] = {};

    for(let i2=1;i2<=4;i2++){

      let dez = (g-1)*4+i2;

      if(g===25 && i2===4) dez = 0;

      dez = String(dez).padStart(2,"0");

      freq[g][dez] = 0;
    }
  });

  datas.forEach(d=>{

    const lista =
      json.historico[d]?.[bancaAtual] || [];

    lista.forEach(item=>{

      [item.p1,item.p2,item.p3,item.p4,item.p5]
        .forEach(n=>{

          const dez = extrairDezena(n);

          if(!dez) return;

          const g = getGrupo(dez);

          if(freq[g] && freq[g][dez] !== undefined){
            freq[g][dez]++;
          }

        });

    });

  });

  box.innerHTML = `
    <div class="grid-5">

      ${bichos.map((b,i)=>{

        const g = i+1;

        return `
          <div class="card">

            ${b[1]}<br><br>

            ${Object.entries(freq[g])
              .map(d=>`${d[0]} : ${d[1]}`)
              .join("<br>")}

          </div>
        `;

      }).join("")}

    </div>
  `;
}

// ================= MAPA =================
function renderBotoesMapa(){

  const box = document.getElementById("mapaBotoes");

  box.innerHTML = [0,1,2,3,4,5,6].map(d=>`
    <button
      onclick="carregarMapa('${bancaAtual}',${d})"
      style="
        background:${d===diaSelecionado ? '#333' : '#ddd'};
      "
    >
      ${d===0 ? "Hoje" : "Dia "+(d+1)}
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

  let dados = [];

  for(let i=dia;i<datas.length;i++){

    dados =
      json.historico[datas[i]]?.[bancaAtual] || [];

    if(dados.length){
      break;
    }
  }

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

    if(v===2) return "#ffd54f";

    if(v===1) return "#a5d6a7";

    return "#eee";
  };

  box.innerHTML = `
    <div class="grid-5">

      ${bichos.map(b=>{

        const v = freq[b[1]];

        return `
          <div style="
            background:${cor(v)};
            padding:10px;
            border-radius:10px;
            text-align:center;
          ">

            ${b[1]}<br><br>

            <b>${v}x</b>

          </div>
        `;

      }).join("")}

    </div>
  `;
}

// ================= IA =================
function getIA(banca){

  if(!usuarioAtual) return {};

  const key = `ia_${usuarioAtual}_${banca}`;

  return JSON.parse(localStorage.getItem(key) || "{}");
}

function salvarIA(banca, data){

  if(!usuarioAtual) return;

  const key = `ia_${usuarioAtual}_${banca}`;

  localStorage.setItem(key, JSON.stringify(data));
}

// ================= IA EXTRA =================
function salvarUltimoPalpite(banca, dados){

  if(!usuarioAtual) return;

  localStorage.setItem(
    `palpite_${usuarioAtual}_${banca}`,
    JSON.stringify(dados)
  );
}

function getUltimoPalpite(banca){

  if(!usuarioAtual) return null;

  return JSON.parse(
    localStorage.getItem(
      `palpite_${usuarioAtual}_${banca}`
    )
  );
}

// ================= PALPITE =================
async function carregarPalpite(banca = bancaAtual){

  const box = document.getElementById("palpiteBox");

  box.innerHTML = "⏳ gerando palpites...";

  try{

    const json = await getDataCompleto();

    if(!json || !json.historico){
      box.innerHTML = "❌ dados inválidos";
      return;
    }

    const historico = json.historico;

    const datas = Object.keys(historico)
      .sort((a,b)=> new Date(b)-new Date(a))
      .slice(0,7);

    let grupos = {};
    let dezenas = {};
    let centenas = {};
    let milhares = {};

    let linhas = {};
    let colunas = {};
    let cruzamentos = {};

    let atraso = {};

    let resultadosRecentes = [];

    datas.forEach((d,index)=>{

      const pesoTempo = 1 - (index * 0.12);

      const lista =
        historico[d]?.[banca] || [];

      lista.forEach(item=>{

        [item.p1,item.p2,item.p3,item.p4,item.p5]
          .forEach(num=>{

            if(!num) return;

            let n =
              String(num).padStart(4,"0");

            resultadosRecentes.push(n);

            const dez = n.slice(-2);

            const cen = n.slice(-3);

            dezenas[dez] =
              (dezenas[dez] || 0) + pesoTempo;

            centenas[cen] =
              (centenas[cen] || 0) + pesoTempo;

            milhares[n] =
              (milhares[n] || 0) + pesoTempo;

            const grupo =
              (dez === "00")
                ? 25
                : Math.ceil(parseInt(dez)/4);

            grupos[grupo] =
              (grupos[grupo] || 0) + pesoTempo;

            const linha = getlinha(grupo);
            const coluna = getcoluna(grupo);

            linhas[linha] =
              (linhas[linha] || 0) + pesoTempo;

            colunas[coluna] =
              (colunas[coluna] || 0) + pesoTempo;

            const cruzKey =
              `${linha}-${coluna}`;

            cruzamentos[cruzKey] =
              (cruzamentos[cruzKey] || 0)
              + pesoTempo;

            atraso[dez] = 0;

          });

      });

      Object.keys(dezenas).forEach(dz=>{

        if(atraso[dz] === undefined){
          atraso[dz] = 1;
        }else{
          atraso[dz]++;
        }

      });

    });

    let ia = getIA(banca);

    if(!ia.grid) ia.grid = {};

    function topIA(obj,n){

      return Object.entries(obj)

        .map(([num,freq])=>{

          const bonusIA =
            (ia[num]?.score || 0);

          const bonusAtraso =
            Math.min((atraso[num] || 0),5);

          const grupo =
            Number(num) <= 25
              ? Number(num)
              : getGrupo(num);

          const linha = getlinha(grupo);
          const coluna = getcoluna(grupo);

          const cruzKey =
            `${linha}-${coluna}`;

          const bonusGrid =
            (cruzamentos[cruzKey] || 0)
            * 0.25;

          const bonusIAGrid =
            (ia.grid?.[cruzKey]?.score || 0)
            * 0.10;

          let score =

            (freq * 0.45) +
            (bonusIA * 0.20) +
            (bonusAtraso * 0.15) +
            (bonusGrid * 0.15) +
            (bonusIAGrid * 0.10);

          score += Math.random() * 0.25;

          return [num,score];

        })

        .sort((a,b)=> b[1]-a[1])
        .slice(0,n)
        .map(i=> i[0]);
    }

    const ultimos =
      resultadosRecentes.slice(0,25);

    const filtrarRecentes = arr =>
      arr.filter(n=> !ultimos.includes(n))
      .slice(0,3);

    const gTop =
      topIA(grupos,5).slice(0,3);

    const dTop =
      filtrarRecentes(
        topIA(dezenas,6)
      );

    const cTop =
      topIA(centenas,3);

    const mTop =
      topIA(milhares,3);

    let gridTop = [];

    dTop.forEach(d=>{

      const grupo = getGrupo(d);

      const linha = getlinha(grupo);

      const coluna = getcoluna(grupo);

      gridTop.push(`${linha}-${coluna}`);
    });

    salvarUltimoPalpite(banca,{
      dezenas:dTop,
      grid:gridTop,
      data:datas[0]
    });

    function duque(arr){

      let out = [];

      for(let i=0;i<arr.length;i++){

        for(let j=i+1;j<arr.length;j++){

          out.push(`${arr[i]}-${arr[j]}`);

        }
      }

      return out;
    }

    function terno(arr){

      if(arr.length < 3) return [];

      return [
        `${arr[0]}-${arr[1]}-${arr[2]}`
      ];
    }

    function card(titulo,valor){

      const texto =
        valor.length
          ? valor.join(" | ")
          : "-";

      return `
        <div class="card">

          <b>${titulo}</b><br><br>

          <div>
            ${valor.join("<br>")}
          </div>

          <br>

          <button onclick="copiarTexto('${texto}')">
            copiar
          </button>

        </div>
      `;
    }

    box.innerHTML = `

      <div class="grid-3">

        ${card("Grupo",gTop)}

        ${card("Dezena",dTop)}

        ${card("Centena",cTop)}

        ${card("Milhar",mTop)}

        ${card("Duque Grupo",duque(gTop))}

        ${card("Duque Dezena",duque(dTop))}

        ${card("Terno Grupo",terno(gTop))}

        ${card("Terno Dezena",terno(dTop))}

        ${card("Linhas Fortes",
      Object.entries(linhas)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(i=>"Linha "+i[0])
    )}

    ${card("Colunas Fortes",
      Object.entries(colunas)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(i=>"Coluna "+i[0])
    )}

    ${card("Cruzamentos Fortes",
      Object.entries(cruzamentos)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,5)
        .map(i=>i[0])
    )}

      </div>

    `;

  }catch(e){

    console.error(e);

    box.innerHTML =
      "❌ erro ao gerar palpite";
  }
}

// ================= INIT =================
window.onload = ()=>{

  carregarUltimoLogin();

  const app = document.getElementById("app");

  if(verificarSessao()){

    iniciarApp();

  }else{

    if(app) app.style.display = "none";

    abrir("login");
  }
};

window.gerarPalpite = function(){
  carregarPalpite(bancaAtual);
};

window.copiarTexto = function(texto){

  navigator.clipboard.writeText(texto)

    .then(()=> alert("✅ Copiado!"))

    .catch(()=> alert("❌ Erro ao copiar"));
};