/* ==========================================================================
   store.js — Estado central de la aplicación (patrón suscripción)
   No toca el DOM ni Firebase: solo guarda datos y avisa a quien escuche.
   La distribución (espacios, orden de pestañas) se recuerda en este
   navegador con localStorage, separada por usuario.
   ========================================================================== */

const ESPACIOS_INICIALES = ['Trabajo', 'Personal', 'Ideas'];
const CAMPOS_TEXTO = ['titulo', 'descripcion', 'contenido'];
const PREFIJO_DISENO = 'altus:diseno:';
const LIMITE_NOMBRE = 40;
const LIMITE_ORDEN = 1500;

/*
  Espacio:  { id, nombre, fijado }
  Nota en memoria:
    { id, userId, categoria,                    // categoria = nombre del espacio
      titulo, descripcion, contenido, fijada,
      fechaActualizacion,                       // campos que viajan a Firestore
      archivo: {nombre, handle, rev}|null,      // solo local: archivo .txt asociado
      _rev, _revTexto, _sucia }                 // control interno
*/
const estado = {
  usuario: null,          // { uid, email } o null (modo local)
  espacios: [],
  espacioActivoId: null,
  notaActivaId: null,
  notas: [],
  ordenNotas: [],         // ids de notas en el orden de las pestañas
  claveDiseno: 'local',   // 'local' o el uid del usuario
};

const oyentes = new Set();
const emitir = () => oyentes.forEach((fn) => fn(estado));

const generarId = () =>
  (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/* ---------- Persistencia de la distribución ---------- */
function leerDiseno(clave) {
  try {
    const crudo = localStorage.getItem(PREFIJO_DISENO + clave);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

function guardarDiseno() {
  try {
    localStorage.setItem(
      PREFIJO_DISENO + estado.claveDiseno,
      JSON.stringify({ espacios: estado.espacios, ordenNotas: estado.ordenNotas.slice(-LIMITE_ORDEN) }),
    );
  } catch {
    // Sin almacenamiento disponible: la distribución solo dura la sesión
  }
}

export function borrarDiseno(clave) {
  try {
    localStorage.removeItem(PREFIJO_DISENO + clave);
  } catch {
    // Sin almacenamiento disponible
  }
}

/* ---------- Lectura ---------- */
export const obtenerEstado = () => estado;

export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export const obtenerNota = (id) => estado.notas.find((n) => n.id === id) ?? null;
export const notaActiva = () => obtenerNota(estado.notaActivaId);
export const obtenerEspacio = (id) => estado.espacios.find((e) => e.id === id) ?? null;
export const espacioActivo = () => obtenerEspacio(estado.espacioActivoId);
export const totalEspacios = () => estado.espacios.length;

/** Espacios en el orden que se muestra: los fijados siempre primero. */
export function espaciosOrdenados() {
  return [...estado.espacios.filter((e) => e.fijado), ...estado.espacios.filter((e) => !e.fijado)];
}

/** Notas del espacio activo; las fijadas siempre van primero. */
export function notasDeEspacioActivo() {
  const nombre = espacioActivo()?.nombre;
  const delEspacio = estado.notas.filter((n) => n.categoria === nombre);
  return [...delEspacio.filter((n) => n.fijada), ...delEspacio.filter((n) => !n.fijada)];
}

export const notaTieneContenido = (nota) => CAMPOS_TEXTO.some((campo) => String(nota[campo] ?? '').trim() !== '');

export function espacioTieneContenido(id) {
  const espacio = obtenerEspacio(id);
  return Boolean(espacio) && estado.notas.some((n) => n.categoria === espacio.nombre && notaTieneContenido(n));
}

/* ---------- Utilidades internas ---------- */
const existeNombre = (nombre, ignorarId) =>
  estado.espacios.some((e) => e.id !== ignorarId && e.nombre.toLowerCase() === nombre.toLowerCase());

function nombreUnico(base) {
  const limpio = String(base).trim().slice(0, LIMITE_NOMBRE) || 'Nuevo Espacio';
  let nombre = limpio;
  let n = 2;
  while (existeNombre(nombre)) nombre = `${limpio.slice(0, LIMITE_NOMBRE - 4)} ${n++}`;
  return nombre;
}

/** Garantiza que exista un espacio con ese nombre y lo devuelve. */
function asegurarEspacio(nombre) {
  let espacio = estado.espacios.find((e) => e.nombre.toLowerCase() === nombre.toLowerCase());
  if (!espacio) {
    espacio = { id: generarId(), nombre: nombre.slice(0, LIMITE_NOMBRE), fijado: false };
    estado.espacios.push(espacio);
  }
  return espacio;
}

/** Mantiene el arreglo de notas ordenado según ordenNotas (las nuevas, al final). */
function aplicarOrden() {
  const orden = estado.ordenNotas.slice();
  const incluidas = new Set(orden);
  for (const n of estado.notas) if (!incluidas.has(n.id)) orden.push(n.id);
  estado.ordenNotas = orden;
  const posicion = new Map(orden.map((id, i) => [id, i]));
  estado.notas.sort((a, b) => posicion.get(a.id) - posicion.get(b.id));
}

/** Si la nota activa ya no está visible, selecciona la primera del espacio. */
function corregirSeleccion() {
  const visibles = notasDeEspacioActivo();
  if (!visibles.some((n) => n.id === estado.notaActivaId)) estado.notaActivaId = visibles[0]?.id ?? null;
}

/* ---------- Fábrica ---------- */
export function construirNota({ id, userId = null, categoria, titulo = '', descripcion = '', contenido = '', fijada = false, archivo = null }) {
  return { id, userId, categoria, titulo, descripcion, contenido, fijada, fechaActualizacion: Date.now(), archivo, _rev: 0, _revTexto: 0, _sucia: false };
}

/* ---------- Distribución ---------- */
/** Carga los espacios y el orden guardados para 'local' o para un uid. */
export function cargarDiseno(clave) {
  // Si ya está cargada esa distribución, se conserva tal cual (mismos ids, sin parpadeos)
  if (clave === estado.claveDiseno && estado.espacios.length) return;
  estado.claveDiseno = clave;
  const guardado = leerDiseno(clave);
  const espacios = [];

  if (guardado && Array.isArray(guardado.espacios)) {
    for (const e of guardado.espacios) {
      const nombre = typeof e?.nombre === 'string' ? e.nombre.trim().slice(0, LIMITE_NOMBRE) : '';
      if (!nombre || espacios.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) continue;
      espacios.push({ id: typeof e.id === 'string' && e.id ? e.id : generarId(), nombre, fijado: e.fijado === true });
    }
  }
  if (!espacios.length) espacios.push(...ESPACIOS_INICIALES.map((nombre) => ({ id: generarId(), nombre, fijado: false })));

  estado.espacios = espacios;
  estado.ordenNotas = Array.isArray(guardado?.ordenNotas) ? guardado.ordenNotas.filter((x) => typeof x === 'string') : [];
  estado.espacioActivoId = espaciosOrdenados()[0].id;
  corregirSeleccion();
  guardarDiseno();
  emitir();
}

/* ---------- Escritura: sesión ---------- */
export function setUsuario(usuario) {
  estado.usuario = usuario;
  emitir();
}

/* ---------- Escritura: espacios ---------- */
export function seleccionarEspacio(id) {
  if (!obtenerEspacio(id)) return;
  estado.espacioActivoId = id;
  estado.notaActivaId = notasDeEspacioActivo()[0]?.id ?? null;
  emitir();
}

/** Crea un espacio con nombre único y lo deja seleccionado. */
export function crearEspacio(nombreBase) {
  const espacio = { id: generarId(), nombre: nombreUnico(nombreBase), fijado: false };
  estado.espacios.push(espacio);
  estado.espacioActivoId = espacio.id;
  estado.notaActivaId = null;
  guardarDiseno();
  emitir();
  return espacio;
}

/**
 * Renombra un espacio y mueve sus notas al nuevo nombre.
 * Devuelve los ids de notas afectadas, [] si no hay cambio y null si el nombre ya existe.
 */
export function renombrarEspacio(id, nuevoNombre) {
  const espacio = obtenerEspacio(id);
  const limpio = String(nuevoNombre).trim().slice(0, LIMITE_NOMBRE);
  if (!espacio || !limpio || limpio === espacio.nombre) return [];
  if (existeNombre(limpio, id)) return null;

  const anterior = espacio.nombre;
  espacio.nombre = limpio;
  const afectadas = [];
  for (const nota of estado.notas) {
    if (nota.categoria !== anterior) continue;
    nota.categoria = limpio;
    nota._rev += 1;
    nota._sucia = Boolean(nota.userId);
    nota.fechaActualizacion = Date.now();
    afectadas.push(nota.id);
  }
  guardarDiseno();
  emitir();
  return afectadas;
}

export function fijarEspacio(id) {
  const espacio = obtenerEspacio(id);
  if (!espacio) return;
  espacio.fijado = !espacio.fijado;
  guardarDiseno();
  emitir();
}

/** Elimina un espacio y sus notas; devuelve las notas quitadas (null si no se puede). */
export function eliminarEspacio(id) {
  const espacio = obtenerEspacio(id);
  if (!espacio || estado.espacios.length <= 1) return null;

  const quitadas = estado.notas.filter((n) => n.categoria === espacio.nombre);
  const idsQuitados = new Set(quitadas.map((n) => n.id));
  estado.notas = estado.notas.filter((n) => !idsQuitados.has(n.id));
  estado.ordenNotas = estado.ordenNotas.filter((nid) => !idsQuitados.has(nid));
  estado.espacios = estado.espacios.filter((e) => e.id !== id);

  if (estado.espacioActivoId === id) estado.espacioActivoId = espaciosOrdenados()[0].id;
  corregirSeleccion();
  guardarDiseno();
  emitir();
  return quitadas;
}

/** Aplica el orden de espacios obtenido al arrastrar. */
export function reordenarEspacios(idsEnOrden) {
  const porId = new Map(estado.espacios.map((e) => [e.id, e]));
  const ordenados = idsEnOrden.map((id) => porId.get(id)).filter(Boolean);
  const resto = estado.espacios.filter((e) => !idsEnOrden.includes(e.id));
  estado.espacios = [...ordenados, ...resto];
  guardarDiseno();
  emitir();
}

/* ---------- Escritura: notas ---------- */
export function seleccionarNota(id) {
  if (!obtenerNota(id)) return;
  estado.notaActivaId = id;
  emitir();
}

export function agregarNota(nota) {
  nota._sucia = Boolean(nota.userId); // pendiente de subir si hay sesión
  estado.notas.push(nota);
  estado.espacioActivoId = asegurarEspacio(nota.categoria).id;
  estado.notaActivaId = nota.id;
  aplicarOrden();
  guardarDiseno();
  emitir();
  return nota;
}

/** Aplica cambios a una nota y la marca como pendiente de guardar. */
export function modificarNota(id, cambios) {
  const nota = obtenerNota(id);
  if (!nota) return null;
  Object.assign(nota, cambios);
  nota._rev += 1;
  if (CAMPOS_TEXTO.some((campo) => campo in cambios)) nota._revTexto += 1;
  nota._sucia = Boolean(nota.userId);
  nota.fechaActualizacion = Date.now();
  emitir();
  return nota;
}

/** Confirma el guardado solo si no hubo ediciones posteriores. */
export function marcarGuardada(id, rev) {
  const nota = obtenerNota(id);
  if (nota && nota._rev === rev) {
    nota._sucia = false;
    emitir();
  }
}

/** Asocia (o cambia) el archivo .txt de una nota; no cuenta como edición. */
export function asociarArchivo(id, archivo) {
  const nota = obtenerNota(id);
  if (!nota) return;
  nota.archivo = archivo;
  emitir();
}

export function quitarNota(id) {
  estado.notas = estado.notas.filter((n) => n.id !== id);
  estado.ordenNotas = estado.ordenNotas.filter((nid) => nid !== id);
  corregirSeleccion();
  guardarDiseno();
  emitir();
}

/** Aplica el orden de pestañas obtenido al arrastrar (solo las del espacio activo). */
export function reordenarNotas(idsEnOrden) {
  aplicarOrden();
  const conjunto = new Set(idsEnOrden);
  let i = 0;
  estado.ordenNotas = estado.ordenNotas.map((id) => (conjunto.has(id) ? idsEnOrden[i++] : id));
  aplicarOrden();
  guardarDiseno();
  emitir();
}

export function limpiarNotas() {
  estado.notas = [];
  estado.notaActivaId = null;
  emitir();
}

/**
 * Fusiona las notas recibidas de Firestore con las locales.
 * Regla: una nota local con cambios pendientes (_sucia) siempre gana.
 */
export function reemplazarNotasRemotas(remotas) {
  const porId = new Map(remotas.map((n) => [n.id, n]));
  const resultado = [];

  for (const previa of estado.notas) {
    const remota = porId.get(previa.id);
    if (previa._sucia) resultado.push(previa);
    else if (remota) resultado.push({ ...remota, archivo: previa.archivo, _rev: previa._rev, _revTexto: previa._revTexto, _sucia: false });
  }

  // Notas nuevas (de otro dispositivo o de la carga inicial), de la más antigua a la más reciente
  const yaIncluidas = new Set(resultado.map((n) => n.id));
  remotas
    .filter((n) => !yaIncluidas.has(n.id))
    .sort((a, b) => a.fechaActualizacion - b.fechaActualizacion)
    .forEach((n) => resultado.push({ ...n, archivo: null, _rev: 0, _revTexto: 0, _sucia: false }));

  estado.notas = resultado;
  for (const n of resultado) asegurarEspacio(n.categoria);
  aplicarOrden();
  corregirSeleccion();
  guardarDiseno();
  emitir();
}
