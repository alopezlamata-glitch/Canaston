/* ═══════════════════════════════════════════════════════════════════
   Bot de canastón. Juega un turno entero (robar, bajar/añadir lo que
   convenga, descartar) usando solo Motor.vistaPara(e, asiento): ve
   exactamente lo mismo que vería un jugador humano en ese asiento,
   nunca las manos ajenas ni el orden del taco.

   En vez de reglas fijas ("si la mano tiene más de 9 cartas..."), cada
   jugada posible se describe con un puñado de características (¿cierra
   una canasta?, ¿gasta un comodín?, ¿deja la mano peligrosamente
   corta?...) y se puntúa con una combinación lineal de pesos:

     puntuacion = Σ  peso[característica] · característica

   Los pesos no están adivinados a mano: salen de entrenar.js, que hace
   jugar al bot contra versions ligeramente distintas de sí mismo miles
   de veces y se queda con las que ganan más. Los pesos aprendidos viven
   en pesos-bot.json; si ese fichero no existe se usan unos de partida
   razonables pero sin entrenar.

     Bot.jugarTurno(e, asiento);   // muta e igual que Motor.aplicar

   Pensado para que el servidor lo llame cuando le toca a un asiento
   marcado como CPU.
   ═══════════════════════════════════════════════════════════════════ */
(function (raiz) {
"use strict";
const esNode = typeof module !== "undefined" && module.exports;
const Motor = esNode ? require("./motor.js") : raiz.Motor;
const {esMono, esTresNegro, valor, claveDe} = Motor;

/* pesos de partida: no son la estrategia final, solo el punto de partida
   desde el que entrenar.js empieza a buscar algo mejor por autojuego */
const PESOS_INICIALES = {
  valor: 12,               // cuánto pesa el valor en puntos de la carta usada
  cierra: 15,               // remata una canasta (llega a 7)
  yaCanasta: 3,              // añadir a un juego que ya era canasta (siempre viene bien, ya iba a mancharse igual)
  comodinUsado: -8,          // gastar un comodín en un juego que aún no está cerrado
  proximidad: 6,             // cuanto más cerca de las 7 cartas, más atractivo completarlo
  lograPositivo: 30,         // esta jugada concreta deja al grupo en "positivo" (limpia + 2 canastas)
  esApertura: 4,             // abrir juego nuevo, en general
  noAbiertoApertura: 10,     // abrir cuando el grupo aún no ha hecho la salida (evita que un comodín ya reservado para un juego a medias tape la estimación del motor)
  esTapon: 6,                // abrir el tapón (3 treses negros): en la mano no valen nada
  esComodinMeld: 8,          // abrir una canasta de puros comodines (vale muchísimo si se completa)
  esAperturaAsistida: -4,    // abrir con solo 2 naturales + comodín (más arriesgado que con 3 naturales)
  numCartas: 4,              // cuántas cartas mueve la jugada
  manoBajaSinPositivo: -10,  // dejaría la mano peligrosamente corta sin haber llegado aún a "positivo"
  pasar: 2,                  // valor de "no bajar más esta vez y guardarme las cartas"
  // ¿merece la pena coger el pozo, o mejor robar del taco? antes era
  // automático (si se podía, se cogía); ahora también se aprende
  esCogerPozo: 20,
  pozoTamano: 10,
  pozoValorTapa: 5,
  pozoAyudaAbierto: 8,
  esRobar: 5,
  // al descartar (menos puntuación = más seguro de tirar)
  dValor: 12,
  dComodin: 40,
  dTresNegro: 16,
  dClaveAjena: 12,
  dUnica: -6
};

let pesosCargados = null;
function cargarPesos(){
  if (pesosCargados) return pesosCargados;
  if (esNode){
    try {
      const guardados = require("./pesos-bot.json");
      pesosCargados = Object.assign({}, PESOS_INICIALES, guardados);
      return pesosCargados;
    } catch { /* no hay pesos entrenados todavía: se usan los de partida */ }
  } else if (raiz.PESOS_BOT_ENTRENADOS){
    pesosCargados = Object.assign({}, PESOS_INICIALES, raiz.PESOS_BOT_ENTRENADOS);
    return pesosCargados;
  }
  pesosCargados = PESOS_INICIALES;
  return pesosCargados;
}

function puntuar(f, pesos){
  let s = 0;
  for (const k in f) if (pesos[k] !== undefined) s += pesos[k] * f[k];
  return s;
}

/* ¿coger el pozo entero o robar del taco? Antes era automático (se cogía
   siempre que era legal); ahora se compara puntuando las dos opciones,
   igual que cualquier otra decisión */
function coger(v, pesos){
  const miGrupo = v.grupos.find(g => g.id === v.miGrupo);
  const claveTapa = claveDe(v.pozo.tapa);
  const yaAbierta = miGrupo.escaleras.some(esc => esc.clave === claveTapa && !esc.canasta);
  const fCoger = {
    esCogerPozo: 1,
    pozoTamano: Math.min(1, v.pozo.total / 20),
    pozoValorTapa: valor(v.pozo.tapa) / 50,
    pozoAyudaAbierto: yaAbierta ? 1 : 0
  };
  return puntuar(fCoger, pesos) >= puntuar({esRobar:1}, pesos);
}

/* hace exactamente una jugada (robar/coger pozo/elegir comodín/bajar algo/
   descartar) y dice si con eso se ha terminado el turno. Es el paso mínimo
   que comparten jugarTurno (todo el turno de golpe, para entrenar.js y los
   tests) y jugarUnPaso (un paso cada vez, para animar el turno online) */
function unPaso(e, asiento, pesos, rechazadas){
  if (e.fase !== "turno" || e.turno !== asiento) return true;

  if (e.faseTurno === "robar"){
    const v = Motor.vistaPara(e, asiento);
    if (v.pozo.estado === "disponible" && coger(v, pesos)){
      const r = Motor.aplicar(e, asiento, {tipo:"cogerPozo"});
      if (r.ok) return false;
      // rechazado (p.ej. te dejaría sin mano y sin nada que cerrar): roba en su lugar
    }
    Motor.aplicar(e, asiento, {tipo:"robar"});
    return false;
  }

  const v = Motor.vistaPara(e, asiento);
  if (e.fase !== "turno" || e.turno !== asiento) return true;   // se acabó el reparto al robar

  if (v.yo.pregunta){
    Motor.aplicar(e, asiento, {tipo:"elegirMono", carta: decidirComodin(v)});
    return false;
  }

  const jugada = mejorJugada(v, rechazadas, pesos);
  if (jugada){
    const r = Motor.aplicar(e, asiento, jugada.accion);
    if (!r.ok) rechazadas.add(jugada.firma);
    return false;
  }

  // no hay más jugadas razonables: cerrar el turno descartando
  Motor.aplicar(e, asiento, {tipo:"descartar", carta: elegirDescarte(v, pesos)});
  return true;
}

function jugarTurno(e, asiento, pesos){
  pesos = pesos || cargarPesos();
  const rechazadas = new Set();
  let guardia = 0;
  while (guardia++ < 80){
    if (unPaso(e, asiento, pesos, rechazadas)) return;
  }
}

/* una sola jugada del turno, para que quien llame (el servidor) pueda
   difundir el estado y esperar un poco entre una y la siguiente, en vez de
   resolver el turno entero de golpe. rechazadas hay que mantenerlo entre
   llamadas del mismo turno (se pasa por fuera) y vaciarlo en el siguiente.
   Devuelve true cuando el turno ha terminado (se ha descartado, o ya no es
   su turno por lo que sea). */
function jugarUnPaso(e, asiento, pesos, rechazadas){
  return unPaso(e, asiento, pesos || cargarPesos(), rechazadas);
}

/* ── candidatos posibles con la mano en fase "jugar", puntuados con pesos ── */
function mejorJugada(v, rechazadas, pesos){
  const mano = v.yo.mano;
  const miGrupo = v.grupos.find(g => g.id === v.miGrupo);
  const candidatos = [];

  // si ya se ha bajado algo este turno sin llegar aún al mínimo (o queda
  // pozo por entregar), el motor no deja descartar: hay que seguir
  // intentando bajar cueste lo que cueste, o la partida se queda encallada
  // sin poder ni completar la salida ni terminar el turno. Esto no es una
  // preferencia de estilo de juego, es la única manera de no romper el
  // turno, así que no entra en lo que se aprende por autojuego.
  const debeSeguir = v.yo.pozoRetenido > 0 || (!miGrupo.abierto && v.yo.puntosDelTurno > 0);

  const manoBaja = costo => miGrupo.positivo ? 0 : Math.max(0, 2 - (mano.length - costo));

  // añadir una carta a un juego propio ya empezado
  miGrupo.escaleras.forEach(esc => {
    mano.forEach(carta => {
      if (!Motor.cabe(esc.clave, esc.cartas, carta)) return;
      const firma = "add:" + esc.indice + ":" + carta.id;
      if (rechazadas.has(firma)) return;
      const cierra = esc.cartas.length === 6;                 // pasaría a 7: cierra canasta
      let lograPositivo = false;
      if (cierra && !esc.canasta){
        const canastasYa = miGrupo.escaleras.filter(e => e.canasta).length;
        const limpiasYa = miGrupo.escaleras.filter(e => e.canasta && e.limpia).length;
        const limpiaSegura = esc.clave === "M" || (esc.cartas.every(c => !esMono(c)) && !esMono(carta));
        lograPositivo = (limpiasYa + (limpiaSegura ? 1 : 0)) >= 1 && canastasYa + 1 >= 2;
      }
      const f = {
        valor: valor(carta) / 50,
        cierra: cierra ? 1 : 0,
        yaCanasta: esc.canasta ? 1 : 0,
        comodinUsado: (!esc.canasta && esMono(carta)) ? 1 : 0,
        proximidad: esc.canasta ? 0 : Math.max(0, 7 - esc.cartas.length) / 7,
        lograPositivo: lograPositivo ? 1 : 0,
        manoBajaSinPositivo: manoBaja(1)
      };
      candidatos.push({firma, costo:1, accion:{tipo:"añadir", escalera:esc.indice, carta:carta.id}, features:f});
    });
  });

  const yaAMedias = new Set(miGrupo.escaleras.filter(e => !e.canasta).map(e => e.clave));
  const noAbierto = miGrupo.abierto ? 0 : 1;

  // abrir un juego nuevo con naturales del mismo número
  const porRango = new Map();
  mano.forEach(c => {
    if (esMono(c) || esTresNegro(c)) return;
    if (!porRango.has(c.rango)) porRango.set(c.rango, []);
    porRango.get(c.rango).push(c);
  });
  porRango.forEach((cs, rango) => {
    if (yaAMedias.has(rango)) return;
    const firma = "abrir:" + rango;
    if (rechazadas.has(firma)) return;
    if (cs.length >= 3){
      const media = cs.reduce((s,c) => s + valor(c), 0) / cs.length / 50;
      const f = { valor:media, esApertura:1, noAbiertoApertura:noAbierto, numCartas:3/7, manoBajaSinPositivo: manoBaja(3) };
      candidatos.push({firma, costo:3, accion:{tipo:"abrir", carta:cs[0].id}, features:f});
    } else if (cs.length === 2 && mano.some(esMono)){
      const media = cs.reduce((s,c) => s + valor(c), 0) / cs.length / 50;
      const f = { valor:media, esApertura:1, noAbiertoApertura:noAbierto, esAperturaAsistida:1,
                  comodinUsado: 1/3, numCartas:3/7, manoBajaSinPositivo: manoBaja(3) };
      candidatos.push({firma, costo:3, accion:{tipo:"abrir", carta:cs[0].id}, features:f});
    }
  });

  // abrir el tapón (3 treses negros): en la mano no valen nada
  if (!yaAMedias.has(3) && !miGrupo.escaleras.some(e => e.clave === 3) && !rechazadas.has("abrir:3")){
    const negros = mano.filter(esTresNegro);
    if (negros.length >= 3){
      const f = { esApertura:1, esTapon:1, noAbiertoApertura:noAbierto, numCartas:3/7, manoBajaSinPositivo: manoBaja(3) };
      candidatos.push({firma:"abrir:3", costo:3, accion:{tipo:"abrir", carta:negros[0].id}, features:f});
    }
  }

  // abrir una canasta de puros comodines
  if (!miGrupo.escaleras.some(e => e.clave === "M") && !rechazadas.has("abrir:M")){
    const monos = mano.filter(esMono);
    if (monos.length >= 5){
      const f = { esApertura:1, esComodinMeld:1, noAbiertoApertura:noAbierto, numCartas:5/7, manoBajaSinPositivo: manoBaja(5) };
      candidatos.push({firma:"abrir:M", costo:5, accion:{tipo:"abrir", carta:monos[0].id}, features:f});
    }
  }

  // "no bajar nada más esta vez": una opción más a puntuar, no un tope fijo.
  // Si el motor obliga a seguir (debeSeguir), no se ofrece: no hay margen
  // para elegir quedarse quieto.
  if (!debeSeguir) candidatos.push({firma:"pasar", costo:0, accion:null, features:{pasar:1}});

  if (!candidatos.length) return null;
  candidatos.forEach(c => c.score = puntuar(c.features, pesos));
  candidatos.sort((a,b) => b.score - a.score);
  return candidatos[0].accion ? candidatos[0] : null;
}

function decidirComodin(v){
  const monos = v.yo.mano.filter(esMono).sort((a,b) => valor(a) - valor(b));
  return monos.length ? monos[0].id : null;      // el comodín más barato primero (el 2 antes que el joker): no hace falta aprenderlo, siempre conviene
}

/* ── qué descartar, puntuado igual que el resto ── */
function elegirDescarte(v, pesos){
  const mano = v.yo.mano;
  if (mano.length === 1) return mano[0].id;

  const clavesAjenas = new Set();
  v.grupos.forEach(g => { if (g.id !== v.miGrupo) g.escaleras.forEach(e => clavesAjenas.add(e.clave)); });

  const opciones = mano.map(c => {
    const repetidas = mano.filter(x => x.rango === c.rango && !esMono(x)).length;
    const f = {
      dValor: valor(c) / 50,
      dComodin: esMono(c) ? 1 : 0,
      dTresNegro: esTresNegro(c) ? 1 : 0,
      dClaveAjena: (!esMono(c) && clavesAjenas.has(c.rango)) ? 1 : 0,
      dUnica: (!esMono(c) && !esTresNegro(c) && repetidas === 1) ? 1 : 0
    };
    return {carta:c, riesgo: puntuar(f, pesos)};
  });
  opciones.sort((a,b) => a.riesgo - b.riesgo);
  return opciones[0].carta.id;
}

const Bot = { jugarTurno, jugarUnPaso, PESOS_INICIALES, cargarPesos, mejorJugada, elegirDescarte, puntuar };
if (esNode) module.exports = Bot;
else raiz.Bot = Bot;

})(typeof globalThis !== "undefined" ? globalThis : this);
