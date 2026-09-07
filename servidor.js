/* ═══════════════════════════════════════════════════════════════════
   Servidor de canastón. Guarda las partidas y manda a cada jugador
   solo lo que puede ver. Los móviles nunca reciben el taco ni las
   manos ajenas, así que no se puede hacer trampa mirando el código.

     npm install
     node servidor.js

   Luego se abre http://localhost:8080 y se comparte el enlace.
   ═══════════════════════════════════════════════════════════════════ */
"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const Motor = require("./motor.js");

const PUERTO = process.env.PORT || 8080;
const RAIZ = __dirname;

/* ── ficheros estáticos ── */
const TIPOS = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
                ".css":"text/css; charset=utf-8", ".ico":"image/x-icon",
                ".json":"application/json; charset=utf-8", ".png":"image/png"};
const servidor = http.createServer((req,res) => {
  let ruta = decodeURIComponent(req.url.split("?")[0]);
  if (ruta === "/") ruta = "/sala.html";
  const abs = path.join(RAIZ, path.normalize(ruta).replace(/^(\.\.[\/\\])+/,""));
  fs.readFile(abs, (err,datos) => {
    if (err){ res.writeHead(404); return res.end("no encontrado"); }
    res.writeHead(200, {"Content-Type": TIPOS[path.extname(abs)] || "text/plain"});
    res.end(datos);
  });
});

/* ── salas ── */
const salas = new Map();
const codigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sin letras que se confundan
  let c = "";
  for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random()*abc.length)];
  return salas.has(c) ? codigo() : c;
};
const ficha = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function nuevaSala(cfg){
  const plazas = Math.min(4, Math.max(2, cfg.plazas|0 || 2));
  const opcionesBarajas = plazas === 4 ? [3,4] : [2,3];
  const barajas = opcionesBarajas.includes(cfg.barajas|0) ? cfg.barajas|0 : (plazas === 2 ? 2 : 3);
  const sala = {
    id: codigo(),
    cfg: {
      plazas,
      parejas: !!cfg.parejas,
      objetivo: cfg.objetivo === 6000 ? 6000 : 10000,
      publica: !!cfg.publica,
      barajas
    },
    asientos: [],          // {nombre, ficha, ws}
    estado: null,
    creada: Date.now()
  };
  salas.set(sala.id, sala);
  return sala;
}

function difundir(sala){
  sala.asientos.forEach((a,i) => {
    if (!a || !a.ws || a.ws.readyState !== 1) return;
    a.ws.send(JSON.stringify({
      tipo: "estado",
      sala: sala.id,
      asiento: i,
      plazas: sala.cfg.plazas,
      objetivo: sala.cfg.objetivo,
      jugadores: sala.asientos.map(x => x ? {nombre:x.nombre, conectado: !!(x.ws && x.ws.readyState===1)} : null),
      vista: sala.estado ? Motor.vistaPara(sala.estado, i) : null
    }));
  });
}
function empezarSiEstaLlena(sala){
  if (sala.estado) return;
  if (sala.asientos.filter(Boolean).length < sala.cfg.plazas) return;
  sala.estado = Motor.crearPartida({
    nombres: sala.asientos.map(a => a.nombre),
    parejas: sala.cfg.parejas,
    objetivo: sala.cfg.objetivo,
    barajas: sala.cfg.barajas
  });
}

/* ── websocket ── */
const wss = new WebSocketServer({ server: servidor });

wss.on("connection", ws => {
  ws.sala = null; ws.asiento = null;

  const error = m => ws.send(JSON.stringify({tipo:"error", mensaje:m}));

  ws.on("message", bruto => {
    let m;
    try { m = JSON.parse(bruto); } catch { return error("mensaje ilegible"); }

    if (m.tipo === "crear"){
      const sala = nuevaSala(m);
      const f = ficha();
      sala.asientos[0] = {nombre: (m.nombre||"Jugador 1").slice(0,14), ficha:f, ws};
      ws.sala = sala.id; ws.asiento = 0;
      ws.send(JSON.stringify({tipo:"sentado", sala:sala.id, asiento:0, ficha:f}));
      empezarSiEstaLlena(sala);
      return difundir(sala);
    }

    if (m.tipo === "unirse"){
      const sala = salas.get((m.sala||"").toUpperCase());
      if (!sala) return error("esa sala no existe");

      // reconexión con la ficha del asiento
      if (m.ficha){
        const i = sala.asientos.findIndex(a => a && a.ficha === m.ficha);
        if (i >= 0){
          sala.asientos[i].ws = ws;
          ws.sala = sala.id; ws.asiento = i;
          ws.send(JSON.stringify({tipo:"sentado", sala:sala.id, asiento:i, ficha:m.ficha}));
          return difundir(sala);
        }
      }
      if (sala.estado) return error("esa partida ya ha empezado");
      const libre = sala.asientos.filter(Boolean).length;
      if (libre >= sala.cfg.plazas) return error("la sala está llena");

      const f = ficha();
      sala.asientos[libre] = {nombre: (m.nombre||("Jugador "+(libre+1))).slice(0,14), ficha:f, ws};
      ws.sala = sala.id; ws.asiento = libre;
      ws.send(JSON.stringify({tipo:"sentado", sala:sala.id, asiento:libre, ficha:f}));
      empezarSiEstaLlena(sala);
      return difundir(sala);
    }

    if (m.tipo === "listar"){
      const lista = [...salas.values()]
        .filter(s => s.cfg.publica && !s.estado && s.asientos.filter(Boolean).length < s.cfg.plazas)
        .sort((a,b) => b.creada - a.creada)
        .map(s => ({
          sala: s.id,
          jugadores: s.asientos.filter(Boolean).map(a => a.nombre),
          plazas: s.cfg.plazas,
          parejas: s.cfg.parejas,
          objetivo: s.cfg.objetivo
        }));
      return ws.send(JSON.stringify({tipo:"salas", salas:lista}));
    }

    if (m.tipo === "accion"){
      const sala = salas.get(ws.sala);
      if (!sala || !sala.estado) return error("no hay partida");
      // el asiento lo pone el servidor, nunca el cliente
      const r = Motor.aplicar(sala.estado, ws.asiento, m.accion);
      if (!r.ok) ws.send(JSON.stringify({tipo:"rechazo", mensaje:r.error}));
      return difundir(sala);
    }

    if (m.tipo === "salir"){
      const sala = salas.get(ws.sala);
      if (!sala) return;
      const asiento = ws.asiento;
      const a = sala.asientos[asiento];
      const nombre = a ? a.nombre : "Alguien";
      ws.sala = null; ws.asiento = null;

      if (sala.estado){
        // con la partida en marcha no se puede continuar sin ese jugador:
        // se avisa a todos y se cierra la sala
        sala.asientos.forEach(x => {
          if (x && x.ws && x.ws.readyState === 1)
            x.ws.send(JSON.stringify({
              tipo: "salaCerrada",
              motivo: x.ws === ws ? null : nombre + " ha abandonado la partida"
            }));
        });
        return salas.delete(sala.id);
      }

      // en la sala de espera basta con liberar el asiento
      sala.asientos[asiento] = null;
      ws.send(JSON.stringify({tipo:"salaCerrada"}));
      if (!sala.asientos.some(Boolean)) return salas.delete(sala.id);
      return difundir(sala);
    }
  });

  ws.on("close", () => {
    const sala = salas.get(ws.sala);
    if (!sala) return;
    const a = sala.asientos[ws.asiento];
    if (a && a.ws === ws) a.ws = null;      // el asiento se guarda para reconectar
    difundir(sala);
  });
});

/* ── limpieza de salas viejas ── */
setInterval(() => {
  const limite = Date.now() - 6*60*60*1000;
  salas.forEach((s,id) => {
    const vivos = s.asientos.filter(a => a && a.ws && a.ws.readyState === 1).length;
    if (!vivos && s.creada < limite) salas.delete(id);
  });
}, 30*60*1000);

servidor.listen(PUERTO, () => {
  console.log("canastón escuchando en http://localhost:" + PUERTO);
});
