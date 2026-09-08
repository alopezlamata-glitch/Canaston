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
   no decida el resultado. El rival no es siempre el mismo: se reparte
   entre los últimos campeones (poolB) para no acabar con unos pesos que
   solo saben ganarle al inmediatamente anterior y pierden contra estilos
   de hace unas generaciones ("sobreajuste cíclico" del autojuego). */
function enfrentar(pesosA, poolB, nPartidas, objetivo, semillaBase, rnd){
  let total = 0;
  for (let i = 0; i < nPartidas; i++){
    const pesosB = poolB[i % poolB.length];
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

/* la comprobación de "atascado" de jugarDuelo (tope de vueltas) puede
   colarse: una partida puede quedarse dando vueltas sin terminar de
   verdad (misma mano, mismo turno, sin avanzar) mucho antes de llegar
   al tope, sobre todo en mesas de 4 que rara vez salen en el muestreo
   normal de entrenamiento. Antes de aceptar una mejora como nuevo
   campeón, se le hace pasar una batería aparte con detección de
   progreso real (no solo un tope de vueltas) en las mesas más
   propensas a esto. Si falla aunque sea una, no se acepta. */
function progresoFirma(e){
  return e.reparto + ":" + e.turno + ":" + e.faseTurno + ":" +
    e.jugadores.map(j => j.mano.length).join(",") + ":" + e.taco.length;
}
function partidaSinAtascos(pesos, nJugadores, parejas, semilla, objetivo){
  const rnd = mulberry32(semilla);
  const nombres = [];
  for (let i = 0; i < nJugadores; i++) nombres.push("V" + i);
  const e = Motor.crearPartida({ nombres, parejas, objetivo, barajas: nJugadores === 2 ? 2 : 3, rnd });
  let vueltas = 0, firmaAnterior = null, sinCambios = 0;
  const MAX_VUELTAS = 40000;
  while (e.fase !== "finPartida" && vueltas < MAX_VUELTAS){
    vueltas++;
    if (e.fase === "finReparto"){ Motor.aplicar(e, 0, {tipo:"siguienteReparto"}); continue; }
    Bot.jugarTurno(e, e.turno, pesos);
    const firma = progresoFirma(e);
    if (firma === firmaAnterior){
      sinCambios++;
      if (sinCambios > 20) return false;
    } else { sinCambios = 0; firmaAnterior = firma; }
  }
  return vueltas < MAX_VUELTAS;
}
function validarSinAtascos(pesos, rnd){
  // la mesa de 4 individual es la más propensa a partidas que se eternizan
  // enganchadas en repartos negativos sin llegar a positivo nunca (a
  // diferencia de un atasco de estado, esto solo aparece con ciertas
  // semillas), así que se le pasan más partidas de prueba que al resto.
  const mesas = [
    {n:2, parejas:false, pruebas:3},
    {n:3, parejas:false, pruebas:3},
    {n:4, parejas:false, pruebas:6},
    {n:4, parejas:true, pruebas:3}
  ];
  for (const mesa of mesas)
    for (let i = 0; i < mesa.pruebas; i++)
      if (!partidaSinAtascos(pesos, mesa.n, mesa.parejas, Math.floor(rnd() * 1e9), 6000))
        return false;
  return true;
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

const TAMANO_POOL = 6;   // cuántos campeones anteriores se guardan como rivales

function guardarCheckpoint(campeon, pool, fuerzaMutacion, generacionesSinMejora, gCompletada){
  fs.writeFileSync(RUTA_PESOS, JSON.stringify(campeon, null, 2) + "\n");
  fs.writeFileSync(RUTA_ESTADO, JSON.stringify({campeon, pool, fuerzaMutacion, generacionesSinMejora, gCompletada}, null, 2) + "\n");
}

function main(){
  const generaciones = parseInt(process.argv[2] || "40", 10);
  const partidasPorDuelo = parseInt(process.argv[3] || "24", 10);
  const hijosPorGeneracion = parseInt(process.argv[4] || "6", 10);
  const objetivo = 6000;      // partidas cortas: entrena más rápido y el criterio (ganar) es el mismo

  const rnd = mulberry32(Date.now() >>> 0);
  let campeon = Object.assign({}, Bot.PESOS_INICIALES);
  let pool = [campeon];
  let fuerzaMutacion = 0.5;
  let generacionesSinMejora = 0;
  let gInicio = 1;

  // reanudar un entrenamiento a medias (p.ej. si se cortó por tiempo)...
  if (fs.existsSync(RUTA_ESTADO)){
    try {
      const estado = JSON.parse(fs.readFileSync(RUTA_ESTADO, "utf8"));
      campeon = estado.campeon;
      pool = estado.pool && estado.pool.length ? estado.pool : [campeon];
      fuerzaMutacion = estado.fuerzaMutacion;
      generacionesSinMejora = estado.generacionesSinMejora;
      gInicio = estado.gCompletada + 1;
      console.log("Reanudando desde la generación", gInicio, "(estado guardado encontrado, pool de", pool.length, "campeones).");
    } catch { console.log("No se pudo leer el estado guardado, se empieza de cero."); }
  // ...o, si no, partir de unos pesos ya entrenados anteriormente en vez
  // de volver a empezar desde los pesos de partida sin entrenar
  } else if (fs.existsSync(RUTA_PESOS)){
    try {
      campeon = Object.assign({}, Bot.PESOS_INICIALES, JSON.parse(fs.readFileSync(RUTA_PESOS, "utf8")));
      pool = [campeon];
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
      const margen = enfrentar(hijo, pool, partidasPorDuelo, objetivo, semillaBase, rnd);
      if (margen > mejorMargen){ mejorMargen = margen; mejorHijo = hijo; }
    }
    if (mejorHijo && mejorMargen > 15 && validarSinAtascos(mejorHijo, rnd)){    // margen mínimo para no quedarse con ruido, y sin atascos en las 4 mesas
      campeon = mejorHijo;
      pool.push(campeon);
      if (pool.length > TAMANO_POOL) pool.shift();
      generacionesSinMejora = 0;
      console.log(`gen ${g}: mejora encontrada, margen +${mejorMargen.toFixed(0)} puntos/partida (pool: ${pool.length})`);
    } else {
      generacionesSinMejora++;
      if (generacionesSinMejora % 5 === 0) fuerzaMutacion *= 0.7;   // si no mejora, busca más cerca
      if (mejorHijo && mejorMargen > 15)
        console.log(`gen ${g}: mejora encontrada (+${mejorMargen.toFixed(0)}) pero rechazada por atascos en la validación, fuerza mutación ${fuerzaMutacion.toFixed(2)}`);
      else
        console.log(`gen ${g}: sin mejora (mejor intento ${mejorMargen.toFixed(0)}), fuerza mutación ${fuerzaMutacion.toFixed(2)}`);
    }
    guardarCheckpoint(campeon, pool, fuerzaMutacion, generacionesSinMejora, g);   // progreso a salvo aunque se corte
  }

  fs.unlinkSync(RUTA_ESTADO);
  console.log("Listo en", ((Date.now()-t0)/1000).toFixed(1), "s. Pesos guardados en pesos-bot.json:");
  console.log(campeon);
}

main();
