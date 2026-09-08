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

/* juega una partida con los pesos A en el asiento 0 (y su pareja, si hay
   parejas) y B en el resto, y devuelve la diferencia de puntos final
   (A - media de B). Se entrena con una mezcla de 2, 3 y 4 jugadores
   (incluidas parejas) para que los pesos no se sobreajusten a un solo
   tamaño de mesa -la primera tanda de entrenamiento solo usaba 2
   jugadores y los pesos resultantes no aguantaban bien las partidas de
   4-. Si una partida no termina en un número razonable de vueltas se
   marca "atascada": eso penaliza al hijo con fuerza, no se trata como
   un empate más, para que nunca se cuele un peso que rompa el juego. */
function jugarDuelo(pesosA, pesosB, semilla, objetivo, nJugadores, parejas){
  const rnd = mulberry32(semilla);
  const nombres = [];
  for (let i = 0; i < nJugadores; i++) nombres.push("J" + i);
  const e = Motor.crearPartida({ nombres, parejas, objetivo, barajas: nJugadores === 2 ? 2 : 3, rnd });
  let vueltas = 0;
  const TOPE = 3000 * nJugadores;
  while (e.fase !== "finPartida" && vueltas < TOPE){
    vueltas++;
    if (e.fase === "finReparto"){ Motor.aplicar(e, 0, {tipo:"siguienteReparto"}); continue; }
    const asiento = e.turno;
    const esA = parejas ? (asiento === 0 || asiento === 2) : asiento === 0;
    Bot.jugarTurno(e, asiento, esA ? pesosA : pesosB);
  }
  if (vueltas >= TOPE) return {atascado:true, diff:0};
  const grupoA = parejas ? e.grupos.find(g => g.asientos.includes(0)) : e.grupos[0];
  const gruposB = e.grupos.filter(g => g !== grupoA);
  const mediaB = gruposB.reduce((s,g) => s + g.puntos, 0) / gruposB.length;
  return {atascado:false, diff: grupoA.puntos - mediaB};
}

function elegirMesa(rnd){
  const r = rnd();
  if (r < 0.40) return {n:2, parejas:false};
  if (r < 0.65) return {n:3, parejas:false};
  if (r < 0.85) return {n:4, parejas:false};
  return {n:4, parejas:true};
}

/* cada duelo se juega dos veces con la misma semilla y la misma mesa,
   alternando quién se sienta primero, para que la ventaja de empezar
   no decida el resultado */
function enfrentar(pesosA, pesosB, nPartidas, objetivo, semillaBase, rnd){
  let total = 0;
  for (let i = 0; i < nPartidas; i++){
    const mesa = elegirMesa(rnd);
    const semilla = semillaBase + i * 7919;
    const r1 = jugarDuelo(pesosA, pesosB, semilla, objetivo, mesa.n, mesa.parejas);
    if (r1.atascado) return -1e6;
    const r2 = jugarDuelo(pesosB, pesosA, semilla, objetivo, mesa.n, mesa.parejas);
    if (r2.atascado) return -1e6;
    total += r1.diff - r2.diff;
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

const RUTA_PESOS = path.join(__dirname, "pesos-bot.json");
const RUTA_ESTADO = path.join(__dirname, ".entrenamiento-estado.json");

function guardarCheckpoint(campeon, fuerzaMutacion, generacionesSinMejora, gCompletada){
  fs.writeFileSync(RUTA_PESOS, JSON.stringify(campeon, null, 2) + "\n");
  fs.writeFileSync(RUTA_ESTADO, JSON.stringify({campeon, fuerzaMutacion, generacionesSinMejora, gCompletada}, null, 2) + "\n");
}

function main(){
  const generaciones = parseInt(process.argv[2] || "40", 10);
  const partidasPorDuelo = parseInt(process.argv[3] || "24", 10);
  const hijosPorGeneracion = parseInt(process.argv[4] || "6", 10);
  const objetivo = 6000;      // partidas cortas: entrena más rápido y el criterio (ganar) es el mismo

  const rnd = mulberry32(Date.now() >>> 0);
  let campeon = Object.assign({}, Bot.PESOS_INICIALES);
  let fuerzaMutacion = 0.5;
  let generacionesSinMejora = 0;
  let gInicio = 1;

  // reanudar un entrenamiento a medias (p.ej. si se cortó por tiempo)...
  if (fs.existsSync(RUTA_ESTADO)){
    try {
      const estado = JSON.parse(fs.readFileSync(RUTA_ESTADO, "utf8"));
      campeon = estado.campeon;
      fuerzaMutacion = estado.fuerzaMutacion;
      generacionesSinMejora = estado.generacionesSinMejora;
      gInicio = estado.gCompletada + 1;
      console.log("Reanudando desde la generación", gInicio, "(estado guardado encontrado).");
    } catch { console.log("No se pudo leer el estado guardado, se empieza de cero."); }
  // ...o, si no, partir de unos pesos ya entrenados anteriormente en vez
  // de volver a empezar desde los pesos de partida sin entrenar
  } else if (fs.existsSync(RUTA_PESOS)){
    try {
      campeon = Object.assign({}, Bot.PESOS_INICIALES, JSON.parse(fs.readFileSync(RUTA_PESOS, "utf8")));
      console.log("Partiendo de los pesos ya guardados en pesos-bot.json.");
    } catch { console.log("No se pudo leer pesos-bot.json, se empieza de cero."); }
  }

  console.log("Entrenamiento:", generaciones, "generaciones,", partidasPorDuelo, "partidas por duelo,", hijosPorGeneracion, "hijos. Empezando en gen", gInicio + ".");
  const t0 = Date.now();

  for (let g = gInicio; g <= generaciones; g++){
    let mejorHijo = null, mejorMargen = 0;
    for (let h = 0; h < hijosPorGeneracion; h++){
      const hijo = mutar(campeon, rnd, fuerzaMutacion);
      const semillaBase = Math.floor(rnd() * 1e9);
      const margen = enfrentar(hijo, campeon, partidasPorDuelo, objetivo, semillaBase, rnd);
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
    guardarCheckpoint(campeon, fuerzaMutacion, generacionesSinMejora, g);   // progreso a salvo aunque se corte
  }

  fs.unlinkSync(RUTA_ESTADO);
  console.log("Listo en", ((Date.now()-t0)/1000).toFixed(1), "s. Pesos guardados en pesos-bot.json:");
  console.log(campeon);
}

main();
