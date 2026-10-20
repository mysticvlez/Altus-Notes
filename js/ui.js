/* ==========================================================================
   ui.js — Todo lo que toca el DOM: render, eventos, menús, arrastre y diálogos.
   No contiene lógica de negocio: delega en los manejadores de app.js.
   Se usa textContent / createElement (nunca innerHTML con datos del usuario);
   la única excepción es la capa de formato del editor, que pasa por el
   parser seguro (escapa el texto antes de formatear).
   ========================================================================== */

import { parsearEnVivo } from './parser.js';
import {
  obtenerEstado, notasDeEspacioActivo, notaActiva, espaciosOrdenados, obtenerNota, obtenerEspacio, totalEspacios,
} from './store.js';

const $ = (id) => document.getElementById(id);

// Referencias a los elementos del DOM (una sola búsqueda al cargar)
const el = {
  velo: $('velo'), sidebar: $('sidebar'), asa: $('asa-sidebar'),
  listaEspacios: $('lista-espacios'), btnNuevoEspacio: $('btn-nuevo-espacio'), btnConfig: $('btn-config'),
  btnEspacios: $('btn-espacios'),
  btnArchivo: $('btn-archivo'), menuArchivo: $('menu-archivo'),
  opAbrir: $('op-abrir'), opGuardar: $('op-guardar'), opGuardarComo: $('op-guardar-como'),
  btnAuth: $('btn-auth'), textoUsuario: $('texto-usuario'),
  tabsIzq: $('tabs-izq'), tabsDer: $('tabs-der'), listaTabs: $('lista-tabs'),
  btnNuevaNota: $('btn-nueva-nota'), btnVacioNueva: $('btn-vacio-nueva'),
  estadoVacio: $('estado-vacio'), nota: $('nota'), estadoGuardado: $('estado-guardado'),
  editor: $('editor'), contador: $('nota-contador'),
  titulo: $('nota-titulo'), descripcion: $('nota-descripcion'), contenido: $('nota-contenido'), capa: $('nota-capa'),
  menuCtx: $('menu-contextual'),
  dialogoAuth: $('dialogo-auth'), formAuth: $('form-auth'), authTitulo: $('auth-titulo'),
  authEmail: $('auth-email'), authPassword: $('auth-password'), authExtra: $('auth-extra'), authConfirmar: $('auth-confirmar'),
  authError: $('auth-error'), authEnviar: $('auth-enviar'), authCancelar: $('auth-cancelar'), authAlternar: $('auth-alternar'),
  dialogoConfig: $('dialogo-config'), configInvitado: $('config-invitado'), configAcceder: $('config-acceder'),
  configCuenta: $('config-cuenta'), configEmail: $('config-email'), configPassword: $('config-password'),
  configOjo: $('config-ojo'), configNotaClave: $('config-nota-clave'), configBorrar: $('config-borrar'), configCerrar: $('config-cerrar'),
  dialogoBorrar: $('dialogo-borrar'), formBorrar: $('form-borrar'), borrarCodigo: $('borrar-codigo'),
  borrarEntrada: $('borrar-entrada'), borrarClaveCaja: $('borrar-clave-caja'), borrarPassword: $('borrar-password'),
  borrarError: $('borrar-error'), borrarCancelar: $('borrar-cancelar'), borrarConfirmar: $('borrar-confirmar'),
  dialogoConfirmar: $('dialogo-confirmar'), confirmarTitulo: $('confirmar-titulo'), confirmarTexto: $('confirmar-texto'),
  confirmarNo: $('confirmar-no'), confirmarSi: $('confirmar-si'),
  aviso: $('aviso'),
};

const ANCHO_MIN = 200;
const ANCHO_MAX = 420;
const CLAVE_ANCHO = 'altus:ancho-sidebar';
const ES_MOVIL = window.matchMedia('(max-width: 720px)');

let acciones = {};            // manejadores que entrega app.js
let hayUsuario = false;
let idNotaMostrada = null;    // nota cuyo contenido está cargado en los campos
let idNotaActivaPrevia = null;
let espacioDeTabs = null;     // espacio cuyas pestañas se mostraron por última vez
let primerRender = true;
let modoAuth = 'login';       // 'login' | 'registro'
let temporizadorAviso = null;
let menuOrigen = null;        // botón que abrió el menú flotante
let codigoBorrado = '';
let borradoNecesitaClave = false;
let ultimaFirmaEspacios = null; // resumen de lo último dibujado: evita repintar si nada cambió
let ultimaFirmaTabs = null;
let ultimoTextoCapa = null;
let procesandoLista = false;    // true mientras se inserta una viñeta por código
let marcoSeguir = 0;            // fotograma pendiente del seguimiento del cursor

const FORMATO_NUMERO = new Intl.NumberFormat('es-MX');

const nodosEspacios = new Map(); // id -> <li>
const nodosTabs = new Map();     // id -> <div>

/* ======================= Inicio ======================= */
export function iniciarUI(manejadores) {
  acciones = manejadores;
  enlazarEspacios();
  enlazarTabs();
  enlazarMenuArchivo();
  enlazarEditor();
  enlazarAuth();
  enlazarConfiguracion();
  enlazarCajonYAncho();
  enlazarGlobales();
  enlazarViewport();
  aplicarModoAuth();
}

/* ======================= Reconciliación de listas =======================
   Mantiene los nodos existentes (para no perder foco ni arrastres) y anima
   la entrada y salida de elementos. */
function siguienteVivo(nodo, claseSale) {
  let actual = nodo;
  while (actual && actual.classList.contains(claseSale)) actual = actual.nextElementSibling;
  return actual;
}

function sincronizarLista(contenedor, mapa, items, { clave, crear, actualizar, claseEntra, claseSale, animar }) {
  const claves = new Set(items.map(clave));

  // Quitar los que ya no están
  for (const [k, nodo] of mapa) {
    if (claves.has(k)) continue;
    mapa.delete(k);
    if (animar) {
      nodo.classList.add(claseSale);
      setTimeout(() => nodo.remove(), 230);
    } else {
      nodo.remove();
    }
  }

  // Crear o actualizar los demás
  const vivos = [];
  for (const item of items) {
    const k = clave(item);
    let nodo = mapa.get(k);
    if (!nodo) {
      nodo = crear(item);
      mapa.set(k, nodo);
      if (animar) {
        nodo.classList.add(claseEntra);
        setTimeout(() => nodo.classList.remove(claseEntra), 260);
      }
    }
    actualizar(nodo, item);
    vivos.push(nodo);
  }

  // Ordenar sin tocar los nodos que ya están en su sitio
  let cursor = siguienteVivo(contenedor.firstElementChild, claseSale);
  for (const nodo of vivos) {
    if (nodo === cursor) cursor = siguienteVivo(cursor.nextElementSibling, claseSale);
    else contenedor.insertBefore(nodo, cursor);
  }
}

/* ======================= Render ======================= */
export function renderizar(estado) {
  hayUsuario = Boolean(estado.usuario);
  renderEspacios(estado);
  renderTabs(estado);
  renderEditor();
  renderSesion(estado);
  primerRender = false;
}

function crearIcono(emoji) {
  const s = document.createElement('span');
  s.className = 'icono';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = emoji;
  return s;
}

function crearBoton(clase, texto, etiqueta) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = clase;
  b.textContent = texto;
  if (etiqueta) b.setAttribute('aria-label', etiqueta);
  return b;
}

/* ---------- Espacios (barra lateral) ---------- */
function crearNodoEspacio(espacio) {
  const li = document.createElement('li');
  li.className = 'espacio';
  li.dataset.id = espacio.id;

  const principal = document.createElement('button');
  principal.type = 'button';
  principal.className = 'espacio__principal';
  const pin = crearIcono('📌');
  pin.classList.add('espacio__pin');
  const nombre = document.createElement('span');
  nombre.className = 'espacio__nombre';
  const cuenta = document.createElement('span');
  cuenta.className = 'espacio__cuenta';
  principal.append(pin, nombre, cuenta);

  const menu = crearBoton('espacio__menu', '⋮', 'Opciones del espacio');
  menu.setAttribute('aria-haspopup', 'menu');
  menu.setAttribute('aria-expanded', 'false');

  li.append(principal, menu);
  return li;
}

function renderEspacios(estado) {
  const cuentas = new Map();
  for (const n of estado.notas) cuentas.set(n.categoria, (cuentas.get(n.categoria) ?? 0) + 1);
  const lista = espaciosOrdenados();

  // Si nada de lo visible cambió (por ejemplo, al escribir), no se toca el DOM
  const firma = `${estado.espacioActivoId}#${lista.map((e) => `${e.id}|${e.nombre}|${e.fijado ? 1 : 0}|${cuentas.get(e.nombre) ?? 0}`).join('¦')}`;
  if (firma === ultimaFirmaEspacios) return;
  ultimaFirmaEspacios = firma;

  sincronizarLista(el.listaEspacios, nodosEspacios, lista, {
    clave: (e) => e.id,
    animar: !primerRender,
    claseEntra: 'espacio--entrando',
    claseSale: 'espacio--saliendo',
    crear: crearNodoEspacio,
    actualizar(nodo, espacio) {
      if (nodo.classList.contains('en-renombrado')) return;
      const activo = espacio.id === estado.espacioActivoId;
      nodo.classList.toggle('espacio--activo', activo);
      const principal = nodo.querySelector('.espacio__principal');
      if (activo) principal.setAttribute('aria-current', 'true');
      else principal.removeAttribute('aria-current');
      nodo.querySelector('.espacio__pin').hidden = !espacio.fijado;
      nodo.querySelector('.espacio__nombre').textContent = espacio.nombre;
      nodo.querySelector('.espacio__cuenta').textContent = String(cuentas.get(espacio.nombre) ?? 0);
    },
  });
}

/* ---------- Pestañas de notas (barra superior) ---------- */
function crearNodoTab(nota) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.id = nota.id;
  tab.setAttribute('role', 'presentation');

  const principal = document.createElement('button');
  principal.type = 'button';
  principal.className = 'tab__principal';
  principal.setAttribute('role', 'tab');
  const pin = crearIcono('📌');
  pin.classList.add('tab__pin');
  const titulo = document.createElement('span');
  titulo.className = 'tab__titulo';
  principal.append(pin, titulo);

  const menu = crearBoton('tab__menu', '≡', 'Opciones de la nota');
  menu.setAttribute('aria-haspopup', 'menu');
  menu.setAttribute('aria-expanded', 'false');
  const cerrar = crearBoton('tab__cerrar', '×', 'Eliminar nota');

  tab.append(principal, menu, cerrar);
  return tab;
}

function renderTabs(estado) {
  const notas = notasDeEspacioActivo();

  // Si nada de lo visible cambió (por ejemplo, al escribir el contenido), no se toca el DOM
  const firma = `${estado.espacioActivoId}#${estado.notaActivaId}#${notas.map((n) => `${n.id}|${n.titulo}|${n.fijada ? 1 : 0}`).join('¦')}`;
  if (firma === ultimaFirmaTabs) return;
  ultimaFirmaTabs = firma;

  // Al cambiar de espacio se reemplaza todo de golpe, sin animar cada pestaña
  if (espacioDeTabs !== estado.espacioActivoId) {
    el.listaTabs.replaceChildren();
    nodosTabs.clear();
    el.listaTabs.scrollLeft = 0;
  }
  const animar = !primerRender && espacioDeTabs === estado.espacioActivoId;
  espacioDeTabs = estado.espacioActivoId;

  sincronizarLista(el.listaTabs, nodosTabs, notas, {
    clave: (n) => n.id,
    animar,
    claseEntra: 'tab--entrando',
    claseSale: 'tab--saliendo',
    crear: crearNodoTab,
    actualizar(nodo, nota) {
      if (nodo.classList.contains('en-renombrado')) return;
      const activa = nota.id === estado.notaActivaId;
      nodo.classList.toggle('tab--activa', activa);
      const principal = nodo.querySelector('.tab__principal');
      principal.setAttribute('aria-selected', String(activa));
      nodo.querySelector('.tab__pin').hidden = !nota.fijada;
      const texto = nota.titulo.trim() || 'Sin título';
      nodo.querySelector('.tab__titulo').textContent = texto;
      principal.title = texto;
    },
  });

  actualizarFlechas();
  if (estado.notaActivaId !== idNotaActivaPrevia) {
    idNotaActivaPrevia = estado.notaActivaId;
    mostrarTabActiva();
  }
}

/** Desplaza la lista para que la pestaña activa quede a la vista. */
function mostrarTabActiva() {
  const ajustar = () => {
    const nodo = nodosTabs.get(idNotaActivaPrevia);
    const lista = el.listaTabs;
    if (!nodo) return;
    const inicio = nodo.offsetLeft;
    const fin = inicio + nodo.offsetWidth;
    if (inicio < lista.scrollLeft) lista.scrollTo({ left: inicio, behavior: 'smooth' });
    else if (fin > lista.scrollLeft + lista.clientWidth) lista.scrollTo({ left: fin - lista.clientWidth, behavior: 'smooth' });
  };
  requestAnimationFrame(ajustar);
  setTimeout(ajustar, 240); // tras terminar la animación de una pestaña nueva
}

/** Muestra las flechas solo cuando las pestañas no caben en pantalla. */
function actualizarFlechas() {
  const lista = el.listaTabs;
  const desborda = lista.scrollWidth > lista.clientWidth + 1;
  el.tabsIzq.hidden = !desborda;
  el.tabsDer.hidden = !desborda;
  if (desborda) {
    el.tabsIzq.disabled = lista.scrollLeft <= 0;
    el.tabsDer.disabled = lista.scrollLeft + lista.clientWidth >= lista.scrollWidth - 1;
  }
}

/* ---------- Editor ---------- */
/** Copia un valor a un campo sin pisar lo que la persona está escribiendo. */
function sincronizarCampo(campo, valor, forzar) {
  if (campo.value !== valor && (forzar || document.activeElement !== campo)) campo.value = valor;
}

/* ---------- Cursor, listas y altura de la pantalla ---------- */

/** Rectángulo en pantalla de la posición del cursor, medido sobre la capa de formato. */
function rectCursor(indice) {
  const recorrido = document.createTreeWalker(el.capa, NodeFilter.SHOW_TEXT);
  let acumulado = 0;
  let nodo = recorrido.nextNode();
  while (nodo) {
    const largo = nodo.nodeValue.length;
    if (indice <= acumulado + largo) break;
    acumulado += largo;
    nodo = recorrido.nextNode();
  }
  if (!nodo) return null;

  const posicion = indice - acumulado;
  const rango = document.createRange();
  const medir = (desde, hasta) => {
    rango.setStart(nodo, desde);
    rango.setEnd(nodo, hasta);
    const rects = rango.getClientRects();
    return rects.length ? rects[rects.length - 1] : null;
  };
  let rect = medir(posicion, posicion);
  if (!rect || rect.height === 0) {
    if (posicion > 0) rect = medir(posicion - 1, posicion);
    else if (posicion < nodo.nodeValue.length) rect = medir(posicion, posicion + 1);
    else rect = null;
  }
  return rect;
}

/** Mantiene el cursor a la vista, con espacio libre debajo, mientras se escribe. */
function seguirCursor() {
  const area = el.contenido;
  if (document.activeElement !== area || el.nota.hidden) return;
  const rect = rectCursor(area.selectionStart);
  if (!rect) return;
  const zona = el.editor.getBoundingClientRect();
  const margenInferior = Math.max(96, zona.height * 0.3);
  const limiteInferior = zona.bottom - margenInferior;
  const limiteSuperior = zona.top + 48;
  if (rect.bottom > limiteInferior) el.editor.scrollTop += rect.bottom - limiteInferior;
  else if (rect.top < limiteSuperior) el.editor.scrollTop -= limiteSuperior - rect.top;
}

function programarSeguirCursor() {
  if (marcoSeguir) return;
  marcoSeguir = requestAnimationFrame(() => {
    marcoSeguir = 0;
    seguirCursor();
  });
}

/** Inserta (o borra, con texto vacío) conservando el historial de deshacer cuando el navegador lo permite. */
function insertarEnCursor(area, texto, desde, hasta) {
  procesandoLista = true;
  try {
    area.focus();
    area.setSelectionRange(desde, hasta);
    const hecho = texto === '' ? document.execCommand('delete') : document.execCommand('insertText', false, texto);
    if (!hecho) {
      area.setRangeText(texto, desde, hasta, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } finally {
    procesandoLista = false;
  }
}

/** "- " al inicio de una línea se convierte en una viñeta. Devuelve true si convirtió. */
function convertirGuion(area) {
  const cursor = area.selectionStart;
  if (cursor !== area.selectionEnd || cursor < 2) return false;
  const texto = area.value;
  if (texto.slice(cursor - 2, cursor) !== '- ') return false;
  const inicioLinea = texto.lastIndexOf('\n', cursor - 3) + 1;
  if (!/^[ \t]*$/.test(texto.slice(inicioLinea, cursor - 2))) return false;
  insertarEnCursor(area, '• ', cursor - 2, cursor);
  return true;
}

/** Enter dentro de una lista: continúa con otra viñeta; sobre una viñeta vacía, termina la lista. */
function continuarLista(e) {
  if (procesandoLista || (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph')) return;
  const area = e.target;
  const cursor = area.selectionStart;
  if (cursor !== area.selectionEnd) return;
  const texto = area.value;
  const inicioLinea = texto.lastIndexOf('\n', cursor - 1) + 1;
  const coincide = texto.slice(inicioLinea, cursor).match(/^([ \t]*)• (.*)$/);
  if (!coincide) return;
  e.preventDefault();
  if (coincide[2].trim() === '') insertarEnCursor(area, '', inicioLinea, cursor);
  else insertarEnCursor(area, `\n${coincide[1]}• `, cursor, cursor);
}

/** La app ocupa exactamente la parte visible de la pantalla (descontando el teclado). */
function ajustarAlturaApp() {
  const vista = window.visualViewport;
  if (!vista || vista.scale > 1.01) return; // con zoom del usuario no se toca
  document.body.style.setProperty('--alto-app', `${Math.round(vista.height)}px`);
}

function enlazarViewport() {
  ajustarAlturaApp();
  const alCambiar = () => {
    ajustarAlturaApp();
    programarSeguirCursor();
  };
  window.visualViewport?.addEventListener('resize', alCambiar);
  window.addEventListener('orientationchange', alCambiar);
  // El teclado tarda un instante en abrirse: después se vuelve a comprobar que el cursor se vea
  el.contenido.addEventListener('focus', () => setTimeout(programarSeguirCursor, 300));
}

function actualizarMenuArchivo(nota) {
  el.opGuardar.disabled = !(nota?.archivo && nota._revTexto !== nota.archivo.rev);
  el.opGuardarComo.disabled = !nota;
}

function renderEditor() {
  const nota = notaActiva();
  el.estadoVacio.hidden = Boolean(nota);
  el.nota.hidden = !nota;
  actualizarMenuArchivo(nota);
  if (!nota) {
    idNotaMostrada = null;
    return;
  }

  const previa = idNotaMostrada;
  const cambioDeNota = nota.id !== previa;
  sincronizarCampo(el.titulo, nota.titulo, cambioDeNota);
  sincronizarCampo(el.descripcion, nota.descripcion, cambioDeNota);
  sincronizarCampo(el.contenido, nota.contenido, cambioDeNota);
  idNotaMostrada = nota.id;

  // Capa de formato en vivo y contador (el parser escapa el HTML antes de formatear)
  if (cambioDeNota || nota.contenido !== ultimoTextoCapa) {
    ultimoTextoCapa = nota.contenido;
    // Si el texto termina en salto de línea, un espacio final hace que esa última línea ocupe altura
    el.capa.innerHTML = parsearEnVivo(nota.contenido) + (nota.contenido.endsWith('\n') ? ' ' : '');
    const total = Array.from(nota.contenido).length;
    el.contador.textContent = `${FORMATO_NUMERO.format(total)} ${total === 1 ? 'carácter' : 'caracteres'}`;
  }
  if (cambioDeNota) el.editor.scrollTop = 0;

  // Transición breve al cambiar de nota
  if (cambioDeNota && previa !== null) {
    el.nota.classList.remove('nota--entra');
    void el.nota.offsetWidth; // reinicia la animación
    el.nota.classList.add('nota--entra');
  }

  let texto;
  if (!nota.userId) texto = 'Solo en esta sesión · inicia sesión para guardar en la nube';
  else texto = nota._sucia ? 'Guardando…' : 'Guardado en la nube';
  if (nota.archivo) {
    texto += ` · Archivo: ${nota.archivo.nombre}`;
    if (nota._revTexto !== nota.archivo.rev) texto += ' (cambios sin guardar en el archivo)';
  }
  el.estadoGuardado.textContent = texto;
}

function renderSesion(estado) {
  el.btnAuth.textContent = estado.usuario ? 'Cerrar sesión' : 'Acceder';
  el.textoUsuario.textContent = estado.usuario ? estado.usuario.email : '';
}

/* ======================= Menús flotantes ======================= */
function abrirMenu(origen, items) {
  cerrarMenu();
  const filas = items.map((item) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.setAttribute('role', 'menuitem');
    boton.className = 'menu-item' + (item.peligro ? ' menu-item--peligro' : '');
    boton.textContent = item.texto;
    boton.disabled = Boolean(item.deshabilitado);
    boton.addEventListener('click', () => {
      cerrarMenu();
      item.accion();
    });
    li.appendChild(boton);
    return li;
  });
  el.menuCtx.replaceChildren(...filas);
  el.menuCtx.hidden = false;

  // Posición junto al botón, sin salirse de la pantalla
  const r = origen.getBoundingClientRect();
  const ancho = el.menuCtx.offsetWidth;
  const alto = el.menuCtx.offsetHeight;
  const izquierda = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8));
  let arriba = r.bottom + 4;
  if (arriba + alto > window.innerHeight - 8) arriba = Math.max(8, r.top - alto - 4);
  el.menuCtx.style.left = `${izquierda}px`;
  el.menuCtx.style.top = `${arriba}px`;

  origen.setAttribute('aria-expanded', 'true');
  menuOrigen = origen;
  el.menuCtx.querySelector('button:not(:disabled)')?.focus();
}

function cerrarMenu(devolverFoco = false) {
  if (el.menuCtx.hidden) return;
  el.menuCtx.hidden = true;
  if (menuOrigen) {
    menuOrigen.setAttribute('aria-expanded', 'false');
    if (devolverFoco) menuOrigen.focus();
  }
  menuOrigen = null;
}

function alternarMenu(origen, obtenerItems) {
  if (menuOrigen === origen) cerrarMenu();
  else abrirMenu(origen, obtenerItems());
}

/* ======================= Renombrado en línea ======================= */
function iniciarRenombrado(nodo, valorActual, limite, alConfirmar) {
  if (nodo.classList.contains('en-renombrado')) return;
  nodo.classList.add('en-renombrado');

  const campo = document.createElement('input');
  campo.type = 'text';
  campo.className = 'renombrar';
  campo.value = valorActual;
  campo.maxLength = limite;
  campo.setAttribute('aria-label', 'Nuevo nombre');
  nodo.appendChild(campo);
  campo.focus();
  campo.select();

  let terminado = false;
  const terminar = (confirmar) => {
    if (terminado) return;
    terminado = true;
    const valor = campo.value;
    campo.remove();
    nodo.classList.remove('en-renombrado');
    if (confirmar) alConfirmar(valor);
  };
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); terminar(true); }
    else if (e.key === 'Escape') { e.stopPropagation(); terminar(false); }
  });
  campo.addEventListener('blur', () => terminar(true));
}

function renombrarEspacioUI(id) {
  const nodo = nodosEspacios.get(id);
  const espacio = obtenerEspacio(id);
  if (!nodo || !espacio) return;
  nodo.scrollIntoView({ block: 'nearest' });
  iniciarRenombrado(nodo, espacio.nombre, 40, (valor) => acciones.renombrarEspacio(id, valor));
}

function renombrarNotaUI(id) {
  const nodo = nodosTabs.get(id);
  const nota = obtenerNota(id);
  if (!nodo || !nota) return;
  iniciarRenombrado(nodo, nota.titulo, 200, (valor) => acciones.renombrarNota(id, valor));
}

/* ======================= Arrastre para reordenar =======================
   Funciona con ratón y con el dedo (mantén pulsado un instante en táctil).
   Los demás elementos se desplazan para abrir el hueco, como en un navegador. */
function habilitarArrastre(contenedor, { itemSel, eje, ignorar, scroller, alSoltar }) {
  const horizontal = eje === 'x';
  let ctx = null;
  let bloqueoClick = 0;

  const items = () => [...contenedor.children].filter((n) => n.matches(itemSel) && !/--saliendo/.test(n.className));
  const scrollActual = () => (horizontal ? scroller.scrollLeft : scroller.scrollTop);
  const trasladar = (px) => (horizontal ? `translateX(${px}px)` : `translateY(${px}px)`);

  function limpiarEscuchas() {
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', cancelar);
  }

  function iniciar() {
    const lista = items();
    const idx = lista.indexOf(ctx.item);
    if (idx < 0) { descartar(); return; }
    const s0 = scrollActual();
    const medidas = lista.map((n) => n.getBoundingClientRect());
    ctx.items = lista;
    ctx.idx = idx;
    ctx.nuevo = idx;
    ctx.scroll0 = s0;
    ctx.pos = medidas.map((r) => (horizontal ? r.left : r.top) + s0);
    ctx.tam = medidas.map((r) => (horizontal ? r.width : r.height));
    const hueco = lista.length > 1 ? ctx.pos[1] - (ctx.pos[0] + ctx.tam[0]) : 0;
    ctx.paso = ctx.tam[idx] + hueco;
    ctx.activo = true;
    ctx.item.classList.add('arrastrando');
    document.body.classList.add('arrastre-activo');
    lista.forEach((n) => { if (n !== ctx.item) n.style.transition = 'transform 0.15s ease'; });
  }

  function descartar() {
    if (!ctx) return;
    clearTimeout(ctx.temporizador);
    limpiarEscuchas();
    ctx = null;
  }

  function autoDesplazar(e) {
    const r = scroller.getBoundingClientRect();
    const zona = 36;
    const paso = 12;
    if (horizontal) {
      if (e.clientX < r.left + zona) scroller.scrollLeft -= paso;
      else if (e.clientX > r.right - zona) scroller.scrollLeft += paso;
    } else if (e.clientY < r.top + zona) scroller.scrollTop -= paso;
    else if (e.clientY > r.bottom - zona) scroller.scrollTop += paso;
  }

  function mover(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    const dx = e.clientX - ctx.x0;
    const dy = e.clientY - ctx.y0;

    if (!ctx.activo) {
      const distancia = Math.hypot(dx, dy);
      if (ctx.tipo === 'mouse') {
        if (distancia <= 5) return;
        iniciar();
      } else {
        if (distancia > 10) descartar(); // el dedo se movió: es un desplazamiento, no un arrastre
        return;
      }
    }
    if (!ctx) return;

    e.preventDefault();
    autoDesplazar(e);
    const delta = (horizontal ? dx : dy) + (scrollActual() - ctx.scroll0);
    const minimo = ctx.pos[0] - ctx.pos[ctx.idx];
    const maximo = ctx.pos[ctx.pos.length - 1] - ctx.pos[ctx.idx];
    const d = Math.min(maximo, Math.max(minimo, delta));
    ctx.item.style.transform = trasladar(d);

    // Nueva posición según cuántos centros quedaron antes del elemento arrastrado
    const centro = ctx.pos[ctx.idx] + ctx.tam[ctx.idx] / 2 + d;
    let nuevo = 0;
    ctx.items.forEach((_, j) => {
      if (j !== ctx.idx && ctx.pos[j] + ctx.tam[j] / 2 < centro) nuevo += 1;
    });
    if (nuevo === ctx.nuevo) return;
    ctx.nuevo = nuevo;
    ctx.items.forEach((n, j) => {
      if (j === ctx.idx) return;
      let desplazamiento = 0;
      if (ctx.idx < nuevo && j > ctx.idx && j <= nuevo) desplazamiento = -ctx.paso;
      else if (ctx.idx > nuevo && j >= nuevo && j < ctx.idx) desplazamiento = ctx.paso;
      n.style.transform = desplazamiento ? trasladar(desplazamiento) : '';
    });
  }

  /** Termina el arrastre: el elemento se asienta en su hueco y se aplica el orden. */
  function terminar(c, aplicarOrden) {
    const destino = aplicarOrden ? c.pos[c.nuevo] - c.pos[c.idx] : 0;
    const nuevo = aplicarOrden ? c.nuevo : c.idx;
    c.item.classList.remove('arrastrando');
    c.item.classList.add('asentando');
    c.item.style.transition = 'transform 0.15s ease';
    c.item.style.transform = trasladar(destino);
    c.items.forEach((n, j) => {
      if (j === c.idx) return;
      if (!aplicarOrden) n.style.transform = '';
    });
    setTimeout(() => {
      c.items.forEach((n) => { n.style.transition = ''; n.style.transform = ''; });
      c.item.classList.remove('asentando');
      document.body.classList.remove('arrastre-activo');
      const orden = c.items.filter((n) => n !== c.item);
      orden.splice(nuevo, 0, c.item);
      if (nuevo !== c.idx) contenedor.insertBefore(c.item, orden[nuevo + 1] ?? null);
      ctx = null;
      if (nuevo !== c.idx) alSoltar(orden.map((n) => n.dataset.id));
    }, 160);
  }

  function soltar(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    const c = ctx;
    clearTimeout(c.temporizador);
    limpiarEscuchas();
    if (!c.activo) { ctx = null; return; }
    bloqueoClick = performance.now() + 400; // evita que el clic final seleccione la pestaña
    terminar(c, true);
  }

  function cancelar(e) {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    const c = ctx;
    clearTimeout(c.temporizador);
    limpiarEscuchas();
    if (!c.activo) { ctx = null; return; }
    terminar(c, false);
  }

  contenedor.addEventListener('pointerdown', (e) => {
    if (ctx || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = e.target.closest(itemSel);
    if (!item || item.parentElement !== contenedor) return;
    if (e.target.closest(ignorar) || item.classList.contains('en-renombrado')) return;
    ctx = { item, pointerId: e.pointerId, tipo: e.pointerType, x0: e.clientX, y0: e.clientY, activo: false, temporizador: null };
    // En táctil el arrastre empieza tras mantener pulsado, para no estorbar al desplazamiento
    if (e.pointerType !== 'mouse') {
      ctx.temporizador = setTimeout(() => { if (ctx && !ctx.activo) iniciar(); }, 380);
    }
    document.addEventListener('pointermove', mover);
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', cancelar);
  });

  // Mientras se arrastra con el dedo no debe desplazarse la página
  contenedor.addEventListener('touchmove', (e) => { if (ctx?.activo) e.preventDefault(); }, { passive: false });
  contenedor.addEventListener('contextmenu', (e) => { if (ctx) e.preventDefault(); });
  contenedor.addEventListener('click', (e) => {
    if (performance.now() < bloqueoClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

/* ======================= Espacios: eventos ======================= */
function itemsMenuEspacio(id) {
  const espacio = obtenerEspacio(id);
  if (!espacio) return [];
  return [
    { texto: espacio.fijado ? 'Desfijar' : 'Fijar', accion: () => acciones.fijarEspacio(id) },
    { texto: 'Eliminar', peligro: true, deshabilitado: totalEspacios() <= 1, accion: () => acciones.eliminarEspacio(id) },
    { texto: 'Cambiar nombre', accion: () => renombrarEspacioUI(id) },
  ];
}

function enlazarEspacios() {
  el.listaEspacios.addEventListener('click', (e) => {
    const li = e.target.closest('.espacio');
    if (!li || li.classList.contains('en-renombrado')) return;
    const menu = e.target.closest('.espacio__menu');
    if (menu) {
      alternarMenu(menu, () => itemsMenuEspacio(li.dataset.id));
    } else if (e.target.closest('.espacio__principal')) {
      acciones.seleccionarEspacio(li.dataset.id);
      cerrarCajonSiMovil(true);
    }
  });
  // Doble clic: cambiar nombre, como en las pestañas de un navegador
  el.listaEspacios.addEventListener('dblclick', (e) => {
    const principal = e.target.closest('.espacio__principal');
    if (principal) renombrarEspacioUI(principal.closest('.espacio').dataset.id);
  });
  el.btnNuevoEspacio.addEventListener('click', () => {
    const id = acciones.nuevoEspacio();
    if (id) renombrarEspacioUI(id);
  });

  habilitarArrastre(el.listaEspacios, {
    itemSel: '.espacio',
    eje: 'y',
    ignorar: '.espacio__menu, input',
    scroller: el.listaEspacios.parentElement,
    alSoltar: (ids) => acciones.reordenarEspacios(ids),
  });
}

/* ======================= Pestañas: eventos ======================= */
function itemsMenuNota(id) {
  const nota = obtenerNota(id);
  if (!nota) return [];
  return [
    { texto: nota.fijada ? 'Desfijar' : 'Fijar', accion: () => acciones.fijarNota(id) },
    { texto: 'Eliminar', peligro: true, accion: () => acciones.eliminarNota(id) },
    { texto: 'Cambiar nombre', accion: () => renombrarNotaUI(id) },
  ];
}

function enlazarTabs() {
  el.listaTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || tab.classList.contains('en-renombrado')) return;
    const id = tab.dataset.id;
    const menu = e.target.closest('.tab__menu');
    if (menu) alternarMenu(menu, () => itemsMenuNota(id));
    else if (e.target.closest('.tab__cerrar')) acciones.eliminarNota(id);
    else if (e.target.closest('.tab__principal')) acciones.seleccionarNota(id);
  });
  el.listaTabs.addEventListener('dblclick', (e) => {
    const principal = e.target.closest('.tab__principal');
    if (principal) renombrarNotaUI(principal.closest('.tab').dataset.id);
  });
  el.btnNuevaNota.addEventListener('click', () => acciones.nuevaNota());
  el.btnVacioNueva.addEventListener('click', () => acciones.nuevaNota());

  // Flechas de desplazamiento
  const salto = () => (el.listaTabs.querySelector('.tab')?.offsetWidth ?? 176) * 2;
  el.tabsIzq.addEventListener('click', () => el.listaTabs.scrollBy({ left: -salto(), behavior: 'smooth' }));
  el.tabsDer.addEventListener('click', () => el.listaTabs.scrollBy({ left: salto(), behavior: 'smooth' }));
  el.listaTabs.addEventListener('scroll', actualizarFlechas, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(actualizarFlechas).observe(el.listaTabs);

  habilitarArrastre(el.listaTabs, {
    itemSel: '.tab',
    eje: 'x',
    ignorar: '.tab__menu, .tab__cerrar, input',
    scroller: el.listaTabs,
    alSoltar: (ids) => acciones.reordenarNotas(ids),
  });
}

/* ======================= Menú Archivo ======================= */
function enlazarMenuArchivo() {
  el.btnArchivo.addEventListener('click', () => {
    cerrarMenu();
    const abrir = el.menuArchivo.hidden;
    el.menuArchivo.hidden = !abrir;
    el.btnArchivo.setAttribute('aria-expanded', String(abrir));
  });
  el.opAbrir.addEventListener('click', () => { cerrarMenuArchivo(); acciones.abrir(); });
  el.opGuardar.addEventListener('click', () => { cerrarMenuArchivo(); acciones.guardar(); });
  el.opGuardarComo.addEventListener('click', () => { cerrarMenuArchivo(); acciones.guardarComo(); });
}

function cerrarMenuArchivo(devolverFoco = false) {
  if (el.menuArchivo.hidden) return;
  el.menuArchivo.hidden = true;
  el.btnArchivo.setAttribute('aria-expanded', 'false');
  if (devolverFoco) el.btnArchivo.focus();
}

/* ======================= Editor: eventos ======================= */
function enlazarEditor() {
  el.titulo.addEventListener('input', (e) => acciones.cambioCampo('titulo', e.target.value));
  el.descripcion.addEventListener('input', (e) => acciones.cambioCampo('descripcion', e.target.value));
  el.contenido.addEventListener('beforeinput', continuarLista);
  el.contenido.addEventListener('input', (e) => {
    // "- " al inicio de línea pasa a viñeta; esa inserción genera su propio evento de entrada
    if (!procesandoLista && !e.isComposing && e.inputType?.startsWith('insert') && convertirGuion(e.target)) return;
    acciones.cambioCampo('contenido', e.target.value);
    programarSeguirCursor();
  });
}

/* ======================= Acceso / registro ======================= */
function aplicarModoAuth() {
  const registro = modoAuth === 'registro';
  el.dialogoAuth.classList.toggle('dialogo--registro', registro);
  el.authExtra.toggleAttribute('inert', !registro);
  el.authConfirmar.required = registro;
  el.authTitulo.textContent = registro ? 'Crear cuenta' : 'Acceder';
  el.authEnviar.textContent = registro ? 'Registrarme' : 'Entrar';
  el.authAlternar.textContent = registro ? '¿Ya tienes cuenta? Accede' : '¿No tienes cuenta? Regístrate';
  el.authPassword.autocomplete = registro ? 'new-password' : 'current-password';
  el.authError.hidden = true;
}

function abrirAuth() {
  modoAuth = 'login';
  aplicarModoAuth();
  cerrarCajonSiMovil(false);
  el.dialogoAuth.showModal();
  el.authEmail.focus();
}

/** Ofrece al navegador guardar la contraseña, si el navegador lo permite. */
async function ofrecerGuardarClave(email, password) {
  try {
    if (window.PasswordCredential && navigator.credentials?.store) {
      await navigator.credentials.store(new window.PasswordCredential({ id: email, password, name: email }));
    }
  } catch {
    // El navegador decide si muestra su propio aviso
  }
}

function mostrarErrorAuth(texto) {
  el.authError.textContent = texto;
  el.authError.hidden = false;
}

function enlazarAuth() {
  el.btnAuth.addEventListener('click', () => {
    if (hayUsuario) acciones.cerrarSesion();
    else abrirAuth();
  });
  el.authCancelar.addEventListener('click', () => el.dialogoAuth.close());
  el.authAlternar.addEventListener('click', () => {
    modoAuth = modoAuth === 'login' ? 'registro' : 'login';
    aplicarModoAuth();
  });

  el.formAuth.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!el.formAuth.reportValidity()) return;
    const registro = modoAuth === 'registro';
    if (registro && el.authPassword.value !== el.authConfirmar.value) {
      mostrarErrorAuth('Las contraseñas no coinciden.');
      return;
    }
    el.authEnviar.disabled = true;
    el.authError.hidden = true;
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    try {
      await acciones.enviarAuth({ modo: modoAuth, email, password });
      await ofrecerGuardarClave(email, password);
      el.dialogoAuth.close();
      // El formulario se limpia un poco después para que el navegador detecte el envío
      setTimeout(() => el.formAuth.reset(), 1200);
    } catch (error) {
      mostrarErrorAuth(error.message);
    } finally {
      el.authEnviar.disabled = false;
    }
  });

  // Ojo para mostrar u ocultar cualquier contraseña
  document.addEventListener('click', (e) => {
    const ojo = e.target.closest('[data-ver-clave]');
    if (!ojo || ojo.disabled) return;
    const campo = $(ojo.dataset.verClave);
    const visible = campo.type === 'password';
    campo.type = visible ? 'text' : 'password';
    ojo.setAttribute('aria-pressed', String(visible));
    ojo.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
}

/* ======================= Configuración y borrado de cuenta ======================= */
function generarCodigo() {
  const valor = new Uint32Array(1);
  crypto.getRandomValues(valor);
  return String(valor[0] % 1000000).padStart(6, '0');
}

function reiniciarOjo(ojo, campo) {
  campo.type = 'password';
  ojo.setAttribute('aria-pressed', 'false');
  ojo.setAttribute('aria-label', 'Mostrar contraseña');
}

function abrirConfiguracion() {
  const usuario = obtenerEstado().usuario;
  el.configInvitado.hidden = Boolean(usuario);
  el.configCuenta.hidden = !usuario;
  if (usuario) {
    const clave = acciones.claveActual();
    el.configEmail.value = usuario.email ?? '';
    el.configPassword.value = clave ?? '';
    reiniciarOjo(el.configOjo, el.configPassword);
    el.configOjo.disabled = !clave;
    el.configNotaClave.hidden = Boolean(clave);
  }
  cerrarCajonSiMovil(false);
  el.dialogoConfig.showModal();
}

function validarBorrado() {
  const codigoOk = el.borrarEntrada.value === codigoBorrado;
  const claveOk = !borradoNecesitaClave || el.borrarPassword.value.length >= 6;
  el.borrarConfirmar.disabled = !(codigoOk && claveOk);
}

function abrirBorrado() {
  codigoBorrado = generarCodigo();
  borradoNecesitaClave = !acciones.claveActual();
  el.borrarCodigo.textContent = codigoBorrado;
  el.borrarEntrada.value = '';
  el.borrarPassword.value = '';
  reiniciarOjo(el.borrarClaveCaja.querySelector('[data-ver-clave]'), el.borrarPassword);
  el.borrarClaveCaja.hidden = !borradoNecesitaClave;
  el.borrarError.hidden = true;
  el.borrarConfirmar.disabled = true;
  el.dialogoBorrar.showModal();
  el.borrarEntrada.focus();
}

function enlazarConfiguracion() {
  el.btnConfig.addEventListener('click', abrirConfiguracion);

  // Correo y contraseña de la cuenta: solo lectura, sin edición, pegado ni arrastre de texto
  for (const campo of [el.configEmail, el.configPassword]) {
    ['beforeinput', 'paste', 'cut', 'drop'].forEach((tipo) => campo.addEventListener(tipo, (e) => e.preventDefault()));
  }
  el.configCerrar.addEventListener('click', () => el.dialogoConfig.close());
  el.configAcceder.addEventListener('click', () => { el.dialogoConfig.close(); abrirAuth(); });
  el.configBorrar.addEventListener('click', abrirBorrado);
  // La contraseña no se deja en el DOM al cerrar
  el.dialogoConfig.addEventListener('close', () => {
    el.configPassword.value = '';
    reiniciarOjo(el.configOjo, el.configPassword);
  });

  el.borrarEntrada.addEventListener('input', () => {
    el.borrarEntrada.value = el.borrarEntrada.value.replace(/\D/g, '').slice(0, 6);
    validarBorrado();
  });
  el.borrarPassword.addEventListener('input', validarBorrado);
  el.borrarCancelar.addEventListener('click', () => el.dialogoBorrar.close());
  el.dialogoBorrar.addEventListener('close', () => { el.borrarPassword.value = ''; });

  el.formBorrar.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (el.borrarEntrada.value !== codigoBorrado) return;
    el.borrarConfirmar.disabled = true;
    el.borrarError.hidden = true;
    try {
      await acciones.borrarCuenta({ password: el.borrarPassword.value });
      el.dialogoBorrar.close();
      el.dialogoConfig.close();
      mostrarAviso('Tu cuenta y tus notas se eliminaron por completo.');
    } catch (error) {
      el.borrarError.textContent = error.message;
      el.borrarError.hidden = false;
      validarBorrado();
    }
  });
}

/* ======================= Confirmación genérica ======================= */
export function confirmar({ titulo, texto, boton = 'Eliminar' }) {
  return new Promise((resolver) => {
    el.confirmarTitulo.textContent = titulo;
    el.confirmarTexto.textContent = texto;
    el.confirmarSi.textContent = boton;
    let resuelto = false;
    const fin = (valor) => {
      if (resuelto) return;
      resuelto = true;
      el.dialogoConfirmar.close();
      resolver(valor);
    };
    el.confirmarSi.onclick = () => fin(true);
    el.confirmarNo.onclick = () => fin(false);
    el.dialogoConfirmar.onclose = () => fin(false); // Escape
    el.dialogoConfirmar.showModal();
  });
}

/* ======================= Barra lateral: cajón en móvil y ancho ajustable ======================= */
function abrirCajon() {
  document.body.classList.add('sidebar-abierta');
  el.velo.hidden = false;
  el.btnEspacios.setAttribute('aria-expanded', 'true');
}

function cerrarCajon() {
  document.body.classList.remove('sidebar-abierta');
  el.velo.hidden = true;
  el.btnEspacios.setAttribute('aria-expanded', 'false');
}

function cerrarCajonSiMovil(siempre) {
  if (siempre ? true : ES_MOVIL.matches) cerrarCajon();
}

function fijarAncho(px, guardar) {
  const ancho = Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, Math.round(px)));
  document.body.style.setProperty('--ancho-sidebar', `${ancho}px`);
  el.asa.setAttribute('aria-valuenow', String(ancho));
  if (guardar) {
    try { localStorage.setItem(CLAVE_ANCHO, String(ancho)); } catch { /* sin almacenamiento */ }
  }
  requestAnimationFrame(actualizarFlechas);
  return ancho;
}

function enlazarCajonYAncho() {
  el.btnEspacios.addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-abierta')) cerrarCajon();
    else abrirCajon();
  });
  el.velo.addEventListener('click', cerrarCajon);

  // Ancho guardado de la barra lateral
  try {
    const guardado = Number(localStorage.getItem(CLAVE_ANCHO));
    if (guardado) fijarAncho(guardado, false);
  } catch { /* sin almacenamiento */ }

  // Arrastre del asa con ratón o dedo
  let arrastrando = false;
  el.asa.addEventListener('pointerdown', (e) => {
    arrastrando = true;
    el.asa.setPointerCapture(e.pointerId);
    el.asa.classList.add('sidebar__asa--activa');
    document.body.classList.add('arrastre-activo');
    e.preventDefault();
  });
  el.asa.addEventListener('pointermove', (e) => {
    if (arrastrando) fijarAncho(e.clientX - el.sidebar.getBoundingClientRect().left, false);
  });
  const soltarAsa = () => {
    if (!arrastrando) return;
    arrastrando = false;
    el.asa.classList.remove('sidebar__asa--activa');
    document.body.classList.remove('arrastre-activo');
    fijarAncho(el.sidebar.getBoundingClientRect().width, true);
  };
  el.asa.addEventListener('pointerup', soltarAsa);
  el.asa.addEventListener('pointercancel', soltarAsa);

  // Teclado: flechas para ajustar, Inicio y Fin para los límites
  el.asa.addEventListener('keydown', (e) => {
    const actual = el.sidebar.getBoundingClientRect().width;
    const mapa = { ArrowLeft: actual - 16, ArrowRight: actual + 16, Home: ANCHO_MIN, End: ANCHO_MAX };
    if (!(e.key in mapa)) return;
    e.preventDefault();
    fijarAncho(mapa[e.key], true);
  });
}

/* ======================= Eventos globales ======================= */
function enlazarGlobales() {
  // Clic fuera: cierra los menús abiertos
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-archivo')) cerrarMenuArchivo();
    if (menuOrigen && !menuOrigen.contains(e.target) && !el.menuCtx.contains(e.target)) cerrarMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!el.menuCtx.hidden) cerrarMenu(true);
      else if (!el.menuArchivo.hidden) cerrarMenuArchivo(true);
      else if (document.body.classList.contains('sidebar-abierta')) cerrarCajon();
      return;
    }
    // Navegación con flechas dentro del menú flotante
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !el.menuCtx.hidden) {
      const botones = [...el.menuCtx.querySelectorAll('button:not(:disabled)')];
      if (!botones.length) return;
      e.preventDefault();
      const i = botones.indexOf(document.activeElement);
      const siguiente = e.key === 'ArrowDown' ? (i + 1) % botones.length : (i - 1 + botones.length) % botones.length;
      botones[siguiente].focus();
    }
  });

  window.addEventListener('resize', () => {
    cerrarMenu();
    if (!ES_MOVIL.matches) cerrarCajon();
    requestAnimationFrame(actualizarFlechas);
  });
  el.editor.addEventListener('scroll', () => cerrarMenu(), { passive: true });
}

/* ======================= Avisos ======================= */
export function mostrarAviso(texto) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.aviso.hidden = true; }, 4500);
}
