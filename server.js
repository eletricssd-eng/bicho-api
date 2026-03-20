const express=require("express");
const cors=require("cors");
const axios=require("axios");
const cheerio=require("cheerio");

const app=express();
app.use(cors());

app.get("/api",async (req,res)=>{

    try{

const url = 
"https://wwww.resultadofacil.com.br/resultado-do-bicho/";
const response = await
axios.get(url,{
    headers: {
        "User-Agent":"Mozilla/5.0",
        "Accept": "text/html"
    }
});
const $ = 
cheerio.load(response.data);

let resultados = [];
const texto = $("body").text();
const milhares = texto.match(/
    \b\d{4}\b/g);

    if(!milhares){
        return res.json({status:"erro",
            motivo:"sem dados"});
        }
        for (let i = 0; i < 5; i++) {
            let milhar = milhares[i];

        resultados.push({
            premio:(i+1)+"º",
            milhar,
            dezena:milhar.slice(-2)
        });
    }

res.json({
    status:"ok",
    resultados
});

}catch (e) { 
    console.log("ERRO REAL",
        e.message)
    res.json({status:"erro",detalhe:
        e.message });
}

});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{
    console.log("Servidor rodando na porta" + PORT);
});
