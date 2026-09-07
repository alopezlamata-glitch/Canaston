/* ═══════════════════════════════════════════════════════════════════
   Motor de canastón. No sabe nada de pantallas ni del DOM.

   Se usa igual en el navegador y en un servidor:

     const e = Motor.crearPartida({nombres:["Ana","Bea"], objetivo:10000});
     Motor.aplicar(e, 0, {tipo:"robar"});
     const loQueVeAna = Motor.vistaPara(e, 0);

   La pieza clave para el juego online es vistaPara: devuelve solo lo que
   ese asiento tiene derecho a ver. La mano de los rivales sale como un
   número, y del taco solo se dice cuántas cartas quedan, nunca cuáles.
   ═══════════════════════════════════════════════════════════════════ */
(function (raiz) {
"use strict";

/* ── cartas ── */
const PALOS = [{c:"♠",roja:false},{c:"♥",roja:true},{c:"♦",roja:true},{c:"♣",roja:false}];
const NR = {2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A",0:"★"};

const esJoker     = c => c.rango === 0;
const esMono      = c => c.rango === 0 || c.rango === 2;
const esFlor      = c => c.rango === 3 && c.palo && c.palo.roja;
const esTresNegro = c => c.rango === 3 && c.palo && !c.palo.roja;
const nombre      = c => esJoker(c) ? "Joker" : NR[c.rango] + c.palo.c;

function valor(c){
  if (esJoker(c)) return 50;
  if (c.rango === 2 || c.rango === 14) return 20;
  if (esFlor(c)) return 100;
  if (c.rango === 3) return 0;
  return c.rango >= 8 ? 10 : 5;
}

function barajar(a, rnd){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function construirMazo(nBarajas, sig, rnd){
  const m = [];
  for (let b = 0; b < nBarajas; b++){
    for (const p of PALOS) for (let r = 2; r <= 14; r++) m.push({id:sig(), rango:r, palo:p});
    m.push({id:sig(), rango:0, palo:null});
    m.push({id:sig(), rango:0, palo:null});
  }
  return barajar(m, rnd);
}

/* ── combinaciones ── */
const naturales = cs => cs.filter(c => !esMono(c)).length;
const monos     = cs => cs.filter(esMono).length;
const esCanasta = c  => c.clave !== 3 && c.cartas.length >= 7;
const claveDe   = c  => esMono(c) ? "M" : esTresNegro(c) ? 3 : c.rango;
const combiDe   = (g,k) => g.combis.find(c => c.clave === k);
const etiquetaClave = k => k === "M" ? "Monos" : k === 3 ? "Treses" : NR[k];

function validar(clave, cs){
  if (clave === "M"){
    if (!cs.every(esMono)) return "solo monos";
    if (cs.length < 5) return "mínimo 5";
    if (cs.length > 7) return "máximo 7";
    return null;
  }
  if (clave === 3){
    if (!cs.every(esTresNegro)) return "solo treses negros";
    if (cs.length < 3) return "mínimo 3";
    return null;
  }
  if (!cs.every(c => esMono(c) || c.rango === clave)) return "no encaja";
  if (naturales(cs) < 2) return "faltan naturales";
  if (monos(cs) > 3) return "máx. 3 monos";
  if (cs.length < 3) return "mínimo 3";
  return null;
}
function cabe(clave, cs, carta, g){
  const t = cs.concat([carta]);
  if (clave === "M") return t.every(esMono) && t.length <= 7;
  if (clave === 3)   return t.every(esTresNegro);
  if (!t.every(c => esMono(c) || c.rango === clave)) return false;
  // la limpieza de una canasta se sella la primera vez que llega a 7 cartas
  // y ya no cambia después (ver cuentaComoLimpia), así que no hay motivo
  // para dejar de admitir cartas de esa pinta una vez cerrada.
  return monos(t) <= 3;
}
function limpiaAlCerrar(c, g){
  if (c.clave === "M") return true;
  if (monos(c.cartas) === 0) return true;
  return !g.cogioPozo;
}
function cuentaComoLimpia(c, g){
  if (!esCanasta(c)) return false;
  if (c.limpia !== undefined) return c.limpia;          // sellado al cerrarse
  return limpiaAlCerrar(c, g);
}
function resumenGrupo(g){
  const canastas = g.combis.filter(esCanasta);
  const limpias  = canastas.filter(c => cuentaComoLimpia(c,g));
  const sucias   = canastas.filter(c => c.clave !== "M" && monos(c.cartas) > 0);
  return {canastas, limpias, sucias, positivo: limpias.length >= 1 && canastas.length >= 2};
}
function bonoCanasta(c, g){
  if (!esCanasta(c)) return 0;
  if (c.clave === "M") return 2000;
  const ases = c.clave === 14;
  if (cuentaComoLimpia(c,g)) return (ases ? 1000 : 500) * (c.dobla ? 2 : 1);
  return ases ? 500 : 300;
}

/* ── estado ── */
const grupoDe = (e,a) => e.grupos.find(g => g.asientos.includes(a));

function minimoSalida(g){
  if (g.puntos < 0) return 15;
  if (g.puntos >= 6000) return 120;
  if (g.puntos >= 3000) return 90;
  return 50;
}

function crearPartida(cfg){
  let n = 0;
  const e = {
    cfg: {
      nombres: cfg.nombres.slice(),
      parejas: !!cfg.parejas,
      objetivo: cfg.objetivo || 10000,
      barajas: cfg.barajas || (cfg.nombres.length === 2 ? 2 : 3)
    },
    _sigId: () => ++n,
    _rnd: cfg.rnd || Math.random,
    jugadores: cfg.nombres.map((nom,i) => ({nombre:nom, asiento:i, mano:[]})),
    grupos: [],
    reparto: 0,
    repartidor: 0
  };
  if (e.cfg.parejas){
    e.grupos.push({id:0, nombre:"Pareja A", asientos:[0,2], puntos:0});
    e.grupos.push({id:1, nombre:"Pareja B", asientos:[1,3], puntos:0});
  } else {
    e.cfg.nombres.forEach((nom,i) => e.grupos.push({id:i, nombre:nom, asientos:[i], puntos:0}));
  }
  repartir(e);
  return e;
}

function repartir(e){
  const n = e.jugadores.length;
  const mazo = construirMazo(e.cfg.barajas, e._sigId, e._rnd);
  e.grupos.forEach(g => {
    g.combis = []; g.flores = []; g.abierto = false; g.cogioPozo = false; g.turnos = 0;
  });
  e.jugadores.forEach(j => j.mano = []);

  let corte = null;
  const arr = mazo[mazo.length - 1];
  if (esJoker(arr) || arr.rango === 3) corte = mazo.pop();

  for (let v = 0; v < 15; v++)
    for (let i = 0; i < n; i++)
      e.jugadores[(e.repartidor + 1 + i) % n].mano.push(mazo.pop());
  if (corte) e.jugadores[e.repartidor].mano.push(corte);

  e.pozoTapado = [];
  for (let i = 0; i < 6; i++) e.pozoTapado.push(mazo.pop());
  e.pozo = [mazo.pop()];
  let guardia = 0;
  while (guardia++ < 40){
    const t = e.pozo[e.pozo.length - 1];
    if (t.rango === 3 || esMono(t)) e.pozo.push(mazo.pop()); else break;
  }
  e.taco = mazo;
  e.volteos = 0;
  e.congeladores = [];

  e.jugadores.forEach(j => {
    let cambio = true;
    while (cambio){
      cambio = false;
      for (let i = j.mano.length - 1; i >= 0; i--)
        if (esFlor(j.mano[i])){
          grupoDe(e, j.asiento).flores.push(j.mano.splice(i,1)[0]);
          if (e.taco.length) j.mano.push(e.taco.pop());
          cambio = true;
        }
    }
  });

  e.reparto++;
  e.turno = (e.repartidor + 1) % n;
  e.fase = "turno";
  e.faseTurno = "robar";
  e.fin = null;
  e.resultados = null;
  reiniciarTurno(e);
  e.sucesos = [];
}
function reiniciarTurno(e){
  e.idsDelPozo = new Set();
  e.pozoRetenido = null;
  e.turnoDePozo = false;
  e.pregunta = null;
  e.grupos.forEach(g => g.combis.forEach(c => c.cartas.forEach(x => x.nueva = false)));
}
const rondaActual   = e => 1 + Math.min.apply(null, e.grupos.map(g => g.turnos));
const esTuPrimerTurno = g => g.turnos === 0;

function puntosNuevosTurno(e,g){
  let s = 0;
  g.combis.forEach(c => c.cartas.forEach(x => { if (x.nueva && !e.idsDelPozo.has(x.id)) s += valor(x); }));
  return s;
}

/* ── cuánto se puede llegar a sumar todavía ── */
function maxPuntosSalida(cartas){
  const porRango = new Map(), comodines = [];
  cartas.forEach(c => {
    if (esMono(c)) { comodines.push(c); return; }
    if (c.rango === 3) return;
    if (!porRango.has(c.rango)) porRango.set(c.rango, []);
    porRango.get(c.rango).push(c);
  });
  comodines.sort((a,b) => valor(b) - valor(a));
  const juegos = [];
  porRango.forEach((cs,r) => { if (cs.length >= 2) juegos.push({r, nat:Math.min(cs.length,7), monos:0}); });
  let i = 0;
  juegos.forEach(j => { if (j.nat === 2 && i < comodines.length){ j.monos = 1; i++; } });
  const validos = juegos.filter(j => j.nat + j.monos >= 3);
  for (const j of validos)
    while (i < comodines.length && j.monos < 3 && j.nat + j.monos < 7){ j.monos++; i++; }
  let total = 0;
  validos.forEach(j => total += j.nat * valor({rango:j.r, palo:PALOS[0]}));
  for (let k = 0; k < i; k++) total += valor(comodines[k]);
  const sobran = comodines.slice(i);
  if (sobran.length >= 5) sobran.slice(0,7).forEach(c => total += valor(c));
  return total;
}
function maxAlcanzable(mano, combis){
  let total = 0;
  const resto = mano.slice();
  (combis||[]).forEach(c => {
    if (c.clave === 3) return;
    const cerrada = c.cartas.length >= 7 && monos(c.cartas) === 0;
    let cap = cerrada ? 0 : (c.clave === "M" ? 7 - c.cartas.length : 99);
    if (cap <= 0) return;
    let capM = 3 - monos(c.cartas);
    for (let i = resto.length - 1; i >= 0 && cap > 0; i--){
      const x = resto[i];
      const encaja = c.clave === "M" ? esMono(x) : (esMono(x) ? capM > 0 : x.rango === c.clave);
      if (!encaja) continue;
      if (c.clave !== "M" && esMono(x)) capM--;
      total += valor(x); resto.splice(i,1); cap--;
    }
  });
  return total + maxPuntosSalida(resto);
}
function salidaSigueViva(e,g){
  if (g.abierto) return true;
  const min = minimoSalida(g), llevas = puntosNuevosTurno(e,g);
  if (llevas >= min) return true;
  return llevas + maxAlcanzable(e.jugadores[e.turno].mano, g.combis) >= min;
}

/* ── pozo ── */
const pozoCongelado  = e => e.congeladores.length > 0;
const cartasNecesarias = e => pozoCongelado(e) ? 3 : 2;
function igualesEnMano(e){
  if (!e.pozo.length) return 0;
  const t = e.pozo[e.pozo.length - 1];
  if (esMono(t)) return 0;
  return e.jugadores[e.turno].mano.filter(c => c.rango === t.rango && !esMono(c)).length;
}
function estadoPozo(e){
  if (!e.pozo.length) return "vacío";
  const t = e.pozo[e.pozo.length - 1], g = grupoDe(e, e.turno);
  if (esTresNegro(t) || esMono(t)) return "taponado";
  if (igualesEnMano(e) < cartasNecesarias(e))
    return pozoCongelado(e) ? "congelado" : "faltan iguales";
  if (!g.abierto && puntosNuevosTurno(e,g) +
      maxPuntosSalida(e.jugadores[e.turno].mano.concat([t])) < minimoSalida(g))
    return "no llegas al mínimo";
  return "disponible";
}
const puedeCogerPozo = e => e.faseTurno === "robar" && estadoPozo(e) === "disponible";

function reponerTaco(e){
  if (e.taco.length) return true;
  if (!e.pozo.length && !e.pozoTapado.length) return false;
  e.taco = e.pozoTapado.concat(e.pozo.slice().reverse());
  e.pozo = []; e.pozoTapado = []; e.congeladores = [];
  e.volteos++;
  return true;
}

/* ── sellos de canasta ── */
function sellarCanastas(e,g){
  g.combis.forEach(c => {
    if (c.limpia !== undefined || !esCanasta(c)) return;
    c.limpia = limpiaAlCerrar(c,g);
    c.cerradaAhora = c.cartas.every(x => x.nueva);
  });
}
function cerrarSellos(e,g){
  g.combis.forEach(c => {
    if (c.dobla !== undefined || !esCanasta(c)) return;
    c.dobla = !e.turnoDePozo && esTuPrimerTurno(g) && !!c.cerradaAhora;
  });
}

/* ── puntuación ── */
function puntuarGrupo(e,g){
  const r = resumenGrupo(g), det = [];
  let total = 0, vCartas = 0, bono = 0;
  g.combis.forEach(c => {
    vCartas += c.cartas.reduce((t,x) => t + valor(x), 0);
    if (esCanasta(c)) bono += bonoCanasta(c,g);
  });
  if (r.positivo){
    if (vCartas){ total += vCartas; det.push(["Cartas bajadas", vCartas]); }
    if (bono){ total += bono; det.push(["Canastas", bono]); }
    if (r.canastas.length >= 8){ total += 2000; det.push(["Canastón", 2000]); }
    else if (r.canastas.length >= 6){ total += 500; det.push(["Canastillo", 500]); }
    if (g.flores.length){ const f = g.flores.length * 100; total += f; det.push(["Flores ("+g.flores.length+")", f]); }
  } else {
    if (vCartas){ total -= vCartas; det.push(["Cartas bajadas, sin limpia y sucia", -vCartas]); }
    if (bono) det.push(["Bonus de canasta, no cuenta", 0]);
    if (g.flores.length) det.push(["Flores ("+g.flores.length+"), no cuentan", 0]);
  }
  if (e.grupoCierra === g.id){ total += 100; det.push(["Cierre", 100]); }
  let mano = 0;
  g.asientos.forEach(a => e.jugadores[a].mano.forEach(c => mano += valor(c)));
  if (mano){
    const doble = e.grupoCierra != null && e.grupoCierra !== g.id && g.combis.length === 0;
    const resta = doble ? mano * 2 : mano;
    total -= resta;
    det.push([doble ? "Cartas en la mano (doble: nada bajado)" : "Cartas en la mano", -resta]);
  }
  if (!det.length) det.push(["Sin puntos", 0]);
  return {total, det, resumen:r};
}
function terminarReparto(e, motivo, idCierra){
  e.grupoCierra = (idCierra === undefined ? null : idCierra);
  e.grupos.forEach(g => cerrarSellos(e,g));
  e.resultados = e.grupos.map(g => {
    const p = puntuarGrupo(e,g);
    g.puntos += p.total;
    return {grupoId:g.id, nombre:g.nombre, total:p.total, det:p.det, acumulado:g.puntos};
  });
  e.motivoFin = motivo;
  const gan = e.grupos.slice().sort((a,b) => b.puntos - a.puntos)
              .find(g => g.puntos >= e.cfg.objetivo);
  e.ganador = gan ? gan.id : null;
  e.fase = gan ? "finPartida" : "finReparto";
}

/* ── acciones ── */
function suceso(e,tipo,datos){ e.sucesos.push(Object.assign({tipo}, datos||{})); }

const ACCIONES = {
  robar(e,g,j){
    if (e.faseTurno !== "robar") return "ya has robado";
    const out = [];
    for (let k = 0; k < 2; k++){
      let c = null;
      while (true){
        if (!e.taco.length && !reponerTaco(e)) break;
        c = e.taco.pop();
        if (esFlor(c)){ g.flores.push(c); suceso(e,"flor",{carta:c, desde:"taco"}); c = null; continue; }
        break;
      }
      if (!c) break;
      out.push(c);
      suceso(e,"roba",{carta:c, asiento:e.turno});
    }
    // se voltea cuanto haga falta, pero si ya no se pueden sacar dos cartas
    // es que solo queda una: ahí acaba el reparto
    if (out.length < 2){ terminarReparto(e, "Se acabaron las cartas"); return null; }
    j.mano.push(...out);
    e.faseTurno = "jugar";
    if (out.length === 1) suceso(e,"ultimaCarta");
    return null;
  },

  cogerPozo(e,g,j){
    if (!puedeCogerPozo(e)) return estadoPozo(e);
    const tapa = e.pozo[e.pozo.length - 1];
    const n = cartasNecesarias(e);
    const usadas = j.mano.filter(c => c.rango === tapa.rango && !esMono(c)).slice(0,n);
    usadas.forEach(c => j.mano.splice(j.mano.findIndex(x => x.id === c.id), 1));

    e.pozoRetenido = e.pozo.concat(e.pozoTapado).filter(c => c.id !== tapa.id);
    e.pozo = []; e.pozoTapado = []; e.congeladores = [];

    let combi = combiDe(g, tapa.rango);
    if (!combi){ combi = {clave:tapa.rango, cartas:[]}; g.combis.push(combi); }
    usadas.concat([tapa]).forEach(c => { c.nueva = true; combi.cartas.push(c); });

    g.cogioPozo = true; e.turnoDePozo = true; e.faseTurno = "jugar";
    suceso(e,"cogePozo",{asiento:e.turno, clave:tapa.rango});
    sellarCanastas(e,g); comprobarEntrega(e,g);
    return null;
  },

  abrir(e,g,j,d){
    const carta = j.mano.find(c => c.id === d.carta);
    if (!carta) return "esa carta no está en tu mano";
    const clave = claveDe(carta);
    // ya tienes una a medias de esa pinta: hay que completarla, no vale
    // abrir una segunda en paralelo. Si la que tienes ya es canasta, sí
    // se puede abrir otra nueva del mismo palo.
    if (g.combis.some(c => c.clave === clave && !esCanasta(c))) return "ya tienes esa escalera";
    if (!esMono(carta) && !esTresNegro(carta)){
      const nat = j.mano.filter(c => c.rango === carta.rango && !esMono(c));
      if (nat.length === 2 && j.mano.some(esMono)){
        e.pregunta = {rango:carta.rango};        // hace falta elegir comodín
        return null;
      }
    }
    const grupo = cartasParaAbrir(carta, j.mano);
    if (!grupo.length) return "te faltan cartas";
    return bajarGrupo(e,g,j,grupo,clave);
  },

  elegirMono(e,g,j,d){
    if (!e.pregunta) return "no hay nada que elegir";
    const q = e.pregunta; e.pregunta = null;
    if (d.carta == null) return null;            // ha dicho que no
    const nat = j.mano.filter(c => c.rango === q.rango && !esMono(c)).slice(0,2);
    const mono = j.mano.find(c => c.id === d.carta && esMono(c));
    if (!mono || nat.length < 2) return "ya no tienes esas cartas";
    return bajarGrupo(e,g,j,nat.concat([mono]),q.rango);
  },

  añadir(e,g,j,d){
    const i = j.mano.findIndex(c => c.id === d.carta);
    if (i < 0) return "esa carta no está en tu mano";
    // hay que cerrar descartando: no se puede jugar la última carta a una
    // escalera y quedarse sin nada que echar al pozo
    if (j.mano.length === 1) return "tienes que cerrar descartando una carta";
    const combi = g.combis[d.escalera];
    if (!combi) return "esa escalera no existe";
    const carta = j.mano[i];
    if (!cabe(combi.clave, combi.cartas, carta, g)) return "ahí no cabe";
    // cualquier carta de más allá de las 7 que cerraron la canasta la
    // ensucia, sea comodín o natural
    const eraLimpia = esCanasta(combi) && cuentaComoLimpia(combi,g);
    j.mano.splice(i,1); carta.nueva = true; combi.cartas.push(carta);
    if (eraLimpia) combi.limpia = false;
    if (!salidaSigueViva(e,g)){
      combi.cartas.pop(); carta.nueva = false; j.mano.push(carta);
      if (eraLimpia) combi.limpia = true;
      return "así no llegas a " + minimoSalida(g);
    }
    sellarCanastas(e,g); comprobarEntrega(e,g);
    return null;
  },

  descartar(e,g,j,d){
    if (e.faseTurno !== "jugar") return "roba antes de descartar";
    const i = j.mano.findIndex(c => c.id === d.carta);
    if (i < 0) return "esa carta no está en tu mano";
    const malo = g.combis.find(c => validar(c.clave, c.cartas));
    if (malo) return etiquetaClave(malo.clave) + ": " + validar(malo.clave, malo.cartas);
    if (e.pozoRetenido)
      return "te faltan " + Math.max(0, minimoSalida(g) - puntosNuevosTurno(e,g)) + " para salir";
    const nuevos = puntosNuevosTurno(e,g);
    if (!g.abierto && nuevos > 0){
      if (nuevos < minimoSalida(g)) return "te faltan " + (minimoSalida(g) - nuevos) + " para salir";
      g.abierto = true;
    }
    const carta = j.mano.splice(i,1)[0];
    e.pozo.push(carta);
    if (esMono(carta)) e.congeladores.push(carta);
    if (esTresNegro(carta)) suceso(e,"tapon",{asiento:e.turno});
    if (j.mano.length === 1) suceso(e,"pumba",{asiento:e.turno});
    suceso(e,"descarta",{carta, asiento:e.turno});
    cerrarSellos(e,g);
    if (!j.mano.length){ terminarReparto(e, j.nombre + " ha cerrado", g.id); return null; }
    g.turnos++;
    reiniciarTurno(e);
    e.turno = (e.turno + 1) % e.jugadores.length;
    e.faseTurno = "robar";
    return null;
  },

  siguienteReparto(e){
    if (e.fase !== "finReparto") return "el reparto no ha terminado";
    e.repartidor = (e.repartidor + 1) % e.jugadores.length;
    repartir(e);
    return null;
  }
};

function cartasParaAbrir(carta, mano){
  if (esTresNegro(carta)){
    const negros = mano.filter(esTresNegro);
    return negros.length >= 3 ? negros.slice(0,3) : [];
  }
  if (esMono(carta)){
    const ms = mano.filter(esMono).sort((a,b) => valor(a) - valor(b));
    return ms.length >= 5 ? ms.slice(0,5) : [];
  }
  const nat = mano.filter(c => c.rango === carta.rango && !esMono(c));
  if (nat.length >= 3) return nat.slice(0,3);
  if (nat.length === 2){
    const mono = mano.filter(esMono).sort((a,b) => valor(a) - valor(b))[0];
    if (mono) return nat.concat([mono]);
  }
  return [];
}
function bajarGrupo(e,g,j,cartas,clave){
  // igual que al añadir: hay que guardarse una carta para cerrar descartando
  if (cartas.length >= j.mano.length) return "tienes que cerrar descartando una carta";
  const combi = {clave, cartas:[]};
  g.combis.push(combi);
  cartas.forEach(c => {
    j.mano.splice(j.mano.findIndex(x => x.id === c.id), 1);
    c.nueva = true; combi.cartas.push(c);
  });
  if (!salidaSigueViva(e,g)){
    combi.cartas.forEach(c => { c.nueva = false; j.mano.push(c); });
    g.combis.splice(g.combis.indexOf(combi), 1);
    return "así no llegas a " + minimoSalida(g);
  }
  sellarCanastas(e,g); comprobarEntrega(e,g);
  return null;
}
function comprobarEntrega(e,g){
  if (!e.pozoRetenido) return;
  if (!g.abierto && puntosNuevosTurno(e,g) < minimoSalida(g)) return;
  g.abierto = true;
  const j = e.jugadores[e.turno];
  let n = 0, fl = 0;
  e.pozoRetenido.forEach(c => {
    if (esFlor(c)){ g.flores.push(c); fl++; suceso(e,"flor",{carta:c, desde:"pozo"}); return; }
    j.mano.push(c); e.idsDelPozo.add(c.id); n++;
    suceso(e,"roba",{carta:c, desde:"pozo", asiento:e.turno});
  });
  e.pozoRetenido = null;
  suceso(e,"entregaPozo",{cartas:n, flores:fl});
}

/* ── punto de entrada: una acción de un asiento ── */
function aplicar(e, asiento, accion){
  if (e.fase === "finReparto" || e.fase === "finPartida"){
    if (accion.tipo !== "siguienteReparto") return {ok:false, error:"el reparto ha terminado"};
  } else if (asiento !== e.turno){
    return {ok:false, error:"no es tu turno"};
  }
  const fn = ACCIONES[accion.tipo];
  if (!fn) return {ok:false, error:"acción desconocida"};
  e.sucesos = [];
  const g = grupoDe(e, e.turno), j = e.jugadores[e.turno];
  const err = fn(e, g, j, accion);
  return err ? {ok:false, error:err} : {ok:true, sucesos:e.sucesos.slice()};
}

/* ── sucesos recortados: para animar en el cliente sin filtrar cartas
   ajenas. "roba" solo lleva la carta si el que robó eres tú, porque
   entra en tu mano. "flor" sí lleva la carta siempre: una flor no
   entra en ninguna mano, se enseña a todos igual que en una mesa
   real. ── */
function redactarSucesos(sucesos, asiento){
  return sucesos.map(s => {
    if (s.tipo === "roba" && s.asiento !== asiento){
      const {carta, ...resto} = s; return resto;
    }
    return s;
  });
}

/* ── vista recortada: lo único que se manda a cada jugador ──
   De los rivales solo va el número de cartas. Del taco, solo cuántas
   quedan. Las tapadas del pozo van como cantidad, nunca como cartas. */
function vistaPara(e, asiento){
  const yo = e.jugadores[asiento];
  const miGrupo = grupoDe(e, asiento);
  const publico = g => ({
    id: g.id, nombre: g.nombre, puntos: g.puntos,
    abierto: g.abierto, minimo: minimoSalida(g),
    flores: g.flores.length,
    canastas: g.combis.filter(esCanasta).length,
    positivo: resumenGrupo(g).positivo,
    escaleras: g.combis.map((c,i) => ({
      indice: i, clave: c.clave, cartas: c.cartas.slice(),
      canasta: esCanasta(c),
      limpia: esCanasta(c) ? cuentaComoLimpia(c,g) : null,
      bono: bonoCanasta(c,g)
    }))
  });
  return {
    asiento,
    yo: {
      nombre: yo.nombre,
      mano: yo.mano.slice(),                       // solo la tuya
      esMiTurno: e.turno === asiento && e.fase === "turno",
      faseTurno: e.turno === asiento ? e.faseTurno : null,
      pregunta: e.turno === asiento ? e.pregunta : null,
      puntosDelTurno: e.turno === asiento ? puntosNuevosTurno(e, miGrupo) : 0,
      pozoRetenido: e.turno === asiento && e.pozoRetenido ? e.pozoRetenido.length : 0
    },
    jugadores: e.jugadores.map(j => ({
      asiento: j.asiento, nombre: j.nombre,
      cartas: j.mano.length,                       // cuántas, no cuáles
      pumba: j.mano.length === 1,
      turno: j.asiento === e.turno
    })),
    grupos: e.grupos.map(publico),
    miGrupo: miGrupo.id,
    taco: e.taco.length,                           // cuántas, nunca el orden
    volteos: e.volteos,
    pozo: {
      total: e.pozo.length + e.pozoTapado.length,
      tapadas: e.pozoTapado.length,
      tapa: e.pozo.length ? e.pozo[e.pozo.length - 1] : null,
      congeladores: e.congeladores.slice(),
      congelado: pozoCongelado(e),
      estado: e.turno === asiento ? estadoPozo(e) : null
    },
    reparto: e.reparto,
    ronda: rondaActual(e),
    fase: e.fase,
    fin: e.fase === "finReparto" || e.fase === "finPartida"
      ? {motivo: e.motivoFin, ganador: e.ganador, resultados: e.resultados}
      : null,
    sucesos: redactarSucesos(e.sucesos, asiento)
  };
}

const Motor = {
  crearPartida, aplicar, vistaPara,
  // utilidades que la interfaz también necesita
  PALOS, NR, valor, nombre, esJoker, esMono, esFlor, esTresNegro,
  esCanasta, claveDe, etiquetaClave, validar, cabe, cuentaComoLimpia,
  bonoCanasta, minimoSalida, cartasParaAbrir, maxPuntosSalida
};

if (typeof module !== "undefined" && module.exports) module.exports = Motor;
else raiz.Motor = Motor;

})(typeof globalThis !== "undefined" ? globalThis : this);
