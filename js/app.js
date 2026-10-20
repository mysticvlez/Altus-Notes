/* ==========================================================================
   app.js — Punto de entrada: conecta store, ui, archivos y Firebase.
   Firebase se carga de forma dinámica: si no hay red, la app sigue
   funcionando en modo local (notas solo en esta sesión).
   ========================================================================== */

import * as store from './store.js';
import * as ui from './ui.js';
import * as fs from './fileSystem.js';

const RETARDO_GUARDADO = 700;   // ms de pausa al escribir antes de subir una nota a Firestore
const RETARDO_DISENO = 600;     // ms de pausa antes de subir la distribución de espacios
const ESPERA_DISENO = 5000;     // ms que se espera a la distribución de la nube antes de usar la copia local

let auth = null;                // módulo auth.js (null si Firebase no cargó)
let db = null;                  // módulo db.js
let cancelarNotas = null;
let cancelarDiseno = null;
let esperaDiseno = null;        // temporizador de la espera de la distribución
let temporizadorDiseno = null;  // subida de la distribución pendiente
let disenoEnVuelo = false;
let avisoNubeMostrado = false;
const temporizadores = new Map(); // idNota -> temporizador de guardado

/* ---------- Utilidades ---------- */
const usuarioActual = () => store.obtenerEstado().usuario;
const nuevoId = () => (usuarioActual() && db ? db.nuevoId() : crypto.randomUUID());
const mensaje = (error, porDefecto) => (error instanceof Error && error.message ? error.message : porDefecto);

/** Crea una nota (vacía o con datos) en el espacio activo. */
function crearNota(datos = {}) {
  const espacio = store.espacioActivo();
  if (!espacio && !datos.categoria) {
    ui.mostrarAviso('Cargando tus espacios…');
    return null;
  }
  const nota = store.construirNota({
    id: nuevoId(),
    userId: usuarioActual()?.uid ?? null,
    categoria: espacio?.nombre,
    ...datos,
  });
  store.agregarNota(nota);
  programarGuardado(nota.id);
  return nota;
}

/* ---------- Guardado diferido de notas en Firestore ---------- */
function programarGuardado(id) {
  if (!db || !usuarioActual()) return; // modo local: nada que subir
  clearTimeout(temporizadores.get(id));
  temporizadores.set(id, setTimeout(async () => {
    temporizadores.delete(id);
    const nota = store.obtenerNota(id);
    if (!nota || !nota.userId) return;
    const rev = nota._rev;
    try {
      await db.guardarNota(nota);
      store.marcarGuardada(id, rev);
    } catch {
      ui.mostrarAviso('No se pudo guardar en la nube. Se reintentará al seguir editando.');
    }
  }, RETARDO_GUARDADO));
}

/** Borra una nota en la nube (si corresponde) sin bloquear la interfaz. */
async function eliminarEnNube(nota) {
  clearTimeout(temporizadores.get(nota.id));
  temporizadores.delete(nota.id);
  if (!nota.userId || !db) return;
  try {
    await db.eliminarNota(nota.id);
  } catch {
    ui.mostrarAviso('No se pudo eliminar en la nube.');
  }
}

/* ---------- Distribución de espacios en la nube ---------- */
function avisarFaltaDeReglas() {
  if (avisoNubeMostrado) return;
  avisoNubeMostrado = true;
  ui.mostrarAviso('Tus espacios no se pueden sincronizar: publica la regla «usuarios» de Firestore (ver js/db.js).');
}

/** Sube la distribución con una pausa, para agrupar varios cambios seguidos. */
function programarSubidaDiseno() {
  if (!db || !usuarioActual()) return;
  clearTimeout(temporizadorDiseno);
  temporizadorDiseno = setTimeout(async () => {
    temporizadorDiseno = null;
    const usuario = usuarioActual();
    if (!usuario) return;
    disenoEnVuelo = true;
    try {
      await db.guardarDisenoNube(usuario.uid, store.exportarDiseno());
    } catch {
      avisarFaltaDeReglas();
    } finally {
      disenoEnVuelo = false;
    }
  }, RETARDO_DISENO);
}

function detenerSuscripciones() {
  cancelarNotas?.();
  cancelarDiseno?.();
  cancelarNotas = null;
  cancelarDiseno = null;
  clearTimeout(esperaDiseno);
  clearTimeout(temporizadorDiseno);
  temporizadorDiseno = null;
  temporizadores.forEach((t) => clearTimeout(t));
  temporizadores.clear();
}

/* ---------- Sesión ---------- */
function alCambiarSesion(usuario) {
  detenerSuscripciones();

  if (!usuario) {
    store.setUsuario(null);
    store.cargarDiseno('local');
    store.limpiarNotas();
    crearNota(); // nota vacía inicial en modo local
    return;
  }

  // Lo que hay en modo local sirve de punto de partida si la cuenta aún no tiene distribución
  const semilla = store.obtenerEstado().claveDiseno === 'local' ? store.exportarDiseno() : null;
  // Rescata las notas escritas en modo local (solo las que tienen contenido)
  const locales = store.obtenerEstado().notas
    .filter((n) => !n.userId && store.notaTieneContenido(n))
    .map((n) => ({ ...n }));

  store.setUsuario(usuario);
  store.cargarDiseno(usuario.uid, semilla);
  store.limpiarNotas();
  for (const local of locales) {
    store.agregarNota(store.construirNota({ ...local, id: db.nuevoId(), userId: usuario.uid }));
  }
  store.obtenerEstado().notas.forEach((n) => programarGuardado(n.id));

  // Distribución de espacios: la de la nube manda sobre la copia de este dispositivo
  cancelarDiseno = db.suscribirDiseno(
    usuario.uid,
    (datos) => {
      if (temporizadorDiseno || disenoEnVuelo) return; // hay cambios propios sin subir
      clearTimeout(esperaDiseno);
      store.aplicarDisenoRemoto(datos);
    },
    () => {
      clearTimeout(esperaDiseno);
      store.usarDisenoTemporal();
      avisarFaltaDeReglas();
    },
  );
  esperaDiseno = setTimeout(() => store.usarDisenoTemporal(), ESPERA_DISENO);

  cancelarNotas = db.suscribirNotas(
    usuario.uid,
    (remotas) => store.reemplazarNotasRemotas(remotas),
    () => ui.mostrarAviso('No se pudieron leer tus notas. Revisa las reglas de Firestore.'),
  );
}

/* ---------- Manejadores de la interfaz ---------- */
const manejadores = {
  /* --- Espacios --- */
  seleccionarEspacio: (id) => store.seleccionarEspacio(id),

  nuevoEspacio() {
    if (!store.disenoListo()) {
      ui.mostrarAviso('Cargando tus espacios…');
      return null;
    }
    const espacio = store.crearEspacio('Nuevo Espacio');
    if (!espacio) ui.mostrarAviso('Alcanzaste el máximo de 50 espacios.');
    return espacio?.id ?? null;
  },

  renombrarEspacio(id, nombre) {
    const afectadas = store.renombrarEspacio(id, nombre);
    if (afectadas === null) ui.mostrarAviso('Ya existe un espacio con ese nombre.');
    else afectadas.forEach(programarGuardado);
  },

  fijarEspacio: (id) => store.fijarEspacio(id),

  async eliminarEspacio(id) {
    const espacio = store.obtenerEspacio(id);
    if (!espacio) return;
    if (store.totalEspacios() <= 1) {
      ui.mostrarAviso('Debe existir al menos un espacio.');
      return;
    }
    // Solo se advierte si el espacio tiene algo escrito
    if (store.espacioTieneContenido(id)) {
      const acepta = await ui.confirmar({
        titulo: `Eliminar «${espacio.nombre}»`,
        texto: 'Este espacio contiene notas con contenido. Se eliminarán de forma permanente.',
      });
      if (!acepta) return;
    }
    const quitadas = store.eliminarEspacio(id);
    quitadas?.forEach(eliminarEnNube);
  },

  reordenarEspacios: (ids) => store.reordenarEspacios(ids),

  /* --- Notas --- */
  seleccionarNota: (id) => store.seleccionarNota(id),
  nuevaNota: () => crearNota(),
  reordenarNotas: (ids) => store.reordenarNotas(ids),

  cambioCampo(campo, valor) {
    if (!['titulo', 'descripcion', 'contenido'].includes(campo)) return;
    const activa = store.notaActiva();
    if (!activa) return;
    store.modificarNota(activa.id, { [campo]: valor });
    programarGuardado(activa.id);
  },

  fijarNota(id) {
    const nota = store.obtenerNota(id);
    if (!nota) return;
    store.modificarNota(id, { fijada: !nota.fijada });
    programarGuardado(id);
  },

  renombrarNota(id, titulo) {
    if (!store.obtenerNota(id)) return;
    store.modificarNota(id, { titulo: titulo.trim().slice(0, 200) });
    programarGuardado(id);
  },

  async eliminarNota(id) {
    const nota = store.obtenerNota(id);
    if (!nota) return;
    // Solo se advierte si la nota tiene algo escrito
    if (store.notaTieneContenido(nota)) {
      const acepta = await ui.confirmar({
        titulo: 'Eliminar nota',
        texto: 'Esta nota tiene contenido. Se eliminará de forma permanente.',
      });
      if (!acepta) return;
    }
    store.quitarNota(id);
    await eliminarEnNube(nota);
  },

  /* --- Menú Archivo --- */
  async abrir() {
    try {
      const resultado = await fs.abrirArchivo();
      if (!resultado) return; // el usuario canceló
      const datos = fs.interpretarTxt(resultado.texto, resultado.nombre);
      // Abrir crea siempre una nota nueva en una pestaña nueva
      crearNota({ ...datos, archivo: { nombre: resultado.nombre, handle: resultado.handle, rev: 0 } });
    } catch (error) {
      ui.mostrarAviso(mensaje(error, 'No se pudo abrir el archivo.'));
    }
  },

  async guardar() {
    const activa = store.notaActiva();
    if (!activa?.archivo) return;
    try {
      const { descargado } = await fs.guardarEnArchivo(activa);
      store.asociarArchivo(activa.id, { ...activa.archivo, rev: activa._revTexto });
      ui.mostrarAviso(descargado
        ? 'Tu navegador no permite sobrescribir archivos: se descargó una copia.'
        : `Guardado en ${activa.archivo.nombre}`);
    } catch (error) {
      ui.mostrarAviso(mensaje(error, 'No se pudo guardar el archivo.'));
    }
  },

  async guardarComo() {
    const activa = store.notaActiva();
    if (!activa) return;
    try {
      const resultado = await fs.guardarComo(activa);
      if (!resultado) return; // el usuario canceló
      store.asociarArchivo(activa.id, { nombre: resultado.nombre, handle: resultado.handle, rev: activa._revTexto });
      ui.mostrarAviso(resultado.descargado
        ? 'Tu navegador no permite elegir la carpeta: se descargó el archivo.'
        : `Guardado como ${resultado.nombre}`);
    } catch (error) {
      ui.mostrarAviso(mensaje(error, 'No se pudo guardar el archivo.'));
    }
  },

  /* --- Cuenta --- */
  async enviarAuth({ modo, email, password }) {
    if (!auth) throw new Error('Firebase no está disponible. Revisa tu conexión.');
    if (modo === 'registro') await auth.registrar(email, password);
    else await auth.iniciarSesion(email, password);
  },

  async cerrarSesion() {
    try {
      await auth.cerrarSesion();
    } catch (error) {
      ui.mostrarAviso(mensaje(error, 'No se pudo cerrar la sesión.'));
    }
  },

  claveActual: () => auth?.claveDeSesion() ?? null,

  /** Borra notas, distribución y cuenta por completo; exige confirmar la contraseña. */
  async borrarCuenta({ password }) {
    const usuario = usuarioActual();
    if (!usuario || !auth || !db) throw new Error('No hay una sesión activa.');
    const clave = auth.claveDeSesion() ?? password;
    if (!clave) throw new Error('Escribe tu contraseña.');

    await auth.reautenticar(clave);
    detenerSuscripciones(); // ninguna edición pendiente debe recrear datos
    try {
      await db.eliminarTodasLasNotas(usuario.uid);
    } catch {
      throw new Error('No se pudieron borrar tus notas. Inténtalo de nuevo.');
    }
    try {
      await db.eliminarDiseno(usuario.uid);
    } catch {
      // Si la regla de distribución no está publicada, no hay nada que borrar
    }
    store.borrarDiseno(usuario.uid);
    await auth.eliminarUsuario(); // al cerrarse la sesión, alCambiarSesion(null) limpia la interfaz
  },
};

/* ---------- Arranque ---------- */
async function iniciar() {
  store.suscribir(ui.renderizar);
  store.alCambiarDiseno(programarSubidaDiseno);
  ui.iniciarUI(manejadores);
  store.cargarDiseno('local'); // espacios visibles desde el primer instante

  // Carga de Firebase (si falla, se sigue en modo local)
  try {
    [auth, db] = await Promise.all([import('./auth.js'), import('./db.js')]);
  } catch {
    ui.mostrarAviso('No se pudo conectar con Firebase: trabajando en modo local.');
  }

  if (auth && db) {
    auth.observarSesion(alCambiarSesion); // entrega la sesión actual al instante
  } else {
    crearNota(); // modo local: nota vacía inicial
  }
}

iniciar();
