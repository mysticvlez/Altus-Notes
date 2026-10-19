/* ==========================================================================
   app.js — Punto de entrada: conecta store, ui, archivos y Firebase.
   Firebase se carga de forma dinámica: si no hay red, la app sigue
   funcionando en modo local (notas solo en esta sesión).
   ========================================================================== */

import * as store from './store.js';
import * as ui from './ui.js';
import * as fs from './fileSystem.js';

const RETARDO_GUARDADO = 700; // ms de pausa al escribir antes de subir a Firestore

let auth = null;                  // módulo auth.js (null si Firebase no cargó)
let db = null;                    // módulo db.js
let cancelarSuscripcion = null;
const temporizadores = new Map(); // idNota -> temporizador de guardado

/* ---------- Utilidades ---------- */
const usuarioActual = () => store.obtenerEstado().usuario;
const nuevoId = () => (usuarioActual() && db ? db.nuevoId() : crypto.randomUUID());
const mensaje = (error, porDefecto) => (error instanceof Error && error.message ? error.message : porDefecto);

/** Crea una nota (vacía o con datos) en el espacio activo. */
function crearNota(datos = {}) {
  const nota = store.construirNota({
    id: nuevoId(),
    userId: usuarioActual()?.uid ?? null,
    categoria: store.espacioActivo().nombre,
    ...datos,
  });
  store.agregarNota(nota);
  programarGuardado(nota.id);
  return nota;
}

/* ---------- Guardado diferido en Firestore ---------- */
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

/* ---------- Sesión ---------- */
function alCambiarSesion(usuario) {
  cancelarSuscripcion?.();
  cancelarSuscripcion = null;
  temporizadores.forEach((t) => clearTimeout(t));
  temporizadores.clear();

  if (!usuario) {
    store.setUsuario(null);
    store.cargarDiseno('local');
    store.limpiarNotas();
    crearNota(); // nota vacía inicial en modo local
    return;
  }

  // Rescata las notas escritas en modo local (solo las que tienen contenido)
  const locales = store.obtenerEstado().notas
    .filter((n) => !n.userId && store.notaTieneContenido(n))
    .map((n) => ({ ...n }));

  store.setUsuario(usuario);
  store.cargarDiseno(usuario.uid);
  store.limpiarNotas();
  for (const local of locales) {
    store.agregarNota(store.construirNota({ ...local, id: db.nuevoId(), userId: usuario.uid }));
  }
  store.obtenerEstado().notas.forEach((n) => programarGuardado(n.id));

  cancelarSuscripcion = db.suscribirNotas(
    usuario.uid,
    (remotas) => store.reemplazarNotasRemotas(remotas),
    () => ui.mostrarAviso('No se pudieron leer tus notas. Revisa las reglas de Firestore.'),
  );
}

/* ---------- Manejadores de la interfaz ---------- */
const manejadores = {
  /* --- Espacios --- */
  seleccionarEspacio: (id) => store.seleccionarEspacio(id),

  nuevoEspacio: () => store.crearEspacio('Nuevo Espacio').id,

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

  /** Borra notas y cuenta por completo; exige confirmar la contraseña. */
  async borrarCuenta({ password }) {
    const usuario = usuarioActual();
    if (!usuario || !auth || !db) throw new Error('No hay una sesión activa.');
    const clave = auth.claveDeSesion() ?? password;
    if (!clave) throw new Error('Escribe tu contraseña.');

    await auth.reautenticar(clave);
    temporizadores.forEach((t) => clearTimeout(t)); // ninguna edición pendiente debe recrear notas
    temporizadores.clear();
    try {
      await db.eliminarTodasLasNotas(usuario.uid);
    } catch {
      throw new Error('No se pudieron borrar tus notas. Inténtalo de nuevo.');
    }
    store.borrarDiseno(usuario.uid);
    await auth.eliminarUsuario(); // al cerrarse la sesión, alCambiarSesion(null) limpia la interfaz
  },
};

/* ---------- Arranque ---------- */
async function iniciar() {
  store.suscribir(ui.renderizar);
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
