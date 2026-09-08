/* ═══════════════════════════════════════════════════════════════════
   Entrena los pesos de bot.js por autojuego: en vez de adivinar a mano
   cuánto vale cada decisión, se generan variantes de los pesos, se las
   hace jugar miles de partidas contra el mejor bot conocido hasta el
   momento, y se queda con las que ganan más. Los pesos resultantes se
   guardan en pesos-bot.json, que bot.js carga solo si existe.

     node entrenar.js [generaciones] [partidas_por_duelo] [hijos_por_generacion]

   Por defecto: 40 generaciones, 24 partidas por duelo, 6 hijos.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const Motor = require("./motor.js");
const Bot = require("./bot.js");

function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* juega una partida de 2 con los pesos A en el asiento 0 y B en el 1, y
   devuelve la diferencia de puntos final (A - B). Si por lo que sea no
   termina (no debería, motor.js y bot.js ya están puestos a prueba para
   que no se atasquen), se corta y se cuenta como empate para no romper
   el entrenamiento por un caso raro aislado. */
function jugarDuelo(pesosA, pesosB, semilla, objetivo){
  const rnd = mulberry32(semilla);
  const e = Motor.crearPartida({ nombres:["A","B"], parejas:false, objetivo, barajas:2, rnd });
  let vueltas = 0;
  const TOPE = 6000;
  while (e.fase !== "finPartida" && vueltas < TOPE){
    vueltas++;
    if (e.fase === "finReparto"){ Motor.aplicar(e, 0, {tipo:"siguienteReparto"}); continue; }
    const asiento = e.turno;
    Bot.jugarTurno(e, asiento, asiento === 0 ? pesosA : pesosB);
  }
  if (vueltas >= TOPE) return 0;
  return e.grupos[0].puntos - e.grupos[1].puntos;
}

/* cada duelo se juega dos veces con la misma semilla, alternando quién
   se sienta primero, para que la ventaja de empezar no decida el resultado */
function enfrentar(pesosA, pesosB, nPartidas, objetivo, semillaBase){
  let total = 0;
  for (let i = 0; i < nPartidas; i++){
    const semilla = semillaBase + i * 7919;
    total += jugarDuelo(pesosA, pesosB, semilla, objetivo);
    total -= jugarDuelo(pesosB, pesosA, semilla, objetivo);
  }
  return total / (nPartidas * 2);
}

function mutar(pesos, rnd, fuerza){
  const hijo = {};
  for (const k in pesos){
    const paso = (rnd() * 2 - 1) * fuerza * (Math.abs(pesos[k]) * 0.4 + 2);
    hijo[k] = pesos[k] + paso;
  }
  return hijo;
}

function main(){
  const generaciones = parseInt(process.argv[2] || "40", 10);
  const partidasPorDuelo = parseInt(process.argv[3] || "24", 10);
  const hijosPorGeneracion = parseInt(process.argv[4] || "6", 10);
  const objetivo = 6000;      // partidas cortas: entrena más rápido y el criterio (ganar) es el mismo

  const rnd = mulberry32(12345);
  let campeon = Object.assign({}, Bot.PESOS_INICIALES);
  let fuerzaMutacion = 0.5;
  let generacionesSinMejora = 0;

  console.log("Empezando entrenamiento:", generaciones, "generaciones,", partidasPorDuelo, "partidas por duelo,", hijosPorGeneracion, "hijos.");
  const t0 = Date.now();

  for (let g = 1; g <= generaciones; g++){
    let mejorHijo = null, mejorMargen = 0;
    for (let h = 0; h < hijosPorGeneracion; h++){
      const hijo = mutar(campeon, rnd, fuerzaMutacion);
      const semillaBase = Math.floor(rnd() * 1e9);
      const margen = enfrentar(hijo, campeon, partidasPorDuelo, objetivo, semillaBase);
      if (margen > mejorMargen){ mejorMargen = margen; mejorHijo = hijo; }
    }
    if (mejorHijo && mejorMargen > 15){    // margen mínimo para no quedarse con ruido
      campeon = mejorHijo;
      generacionesSinMejora = 0;
      console.log(`gen ${g}: mejora encontrada, margen +${mejorMargen.toFixed(0)} puntos/partida`);
    } else {
      generacionesSinMejora++;
      if (generacionesSinMejora % 5 === 0) fuerzaMutacion *= 0.7;   // si no mejora, busca más cerca
      console.log(`gen ${g}: sin mejora (mejor intento ${mejorMargen.toFixed(0)}), fuerza mutación ${fuerzaMutacion.toFixed(2)}`);
    }
  }

  fs.writeFileSync(path.join(__dirname, "pesos-bot.json"), JSON.stringify(campeon, null, 2) + "\n");
  console.log("Listo en", ((Date.now()-t0)/1000).toFixed(1), "s. Pesos guardados en pesos-bot.json:");
  console.log(campeon);
}

main();
