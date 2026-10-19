/* ==========================================================================
   fileSystem.js — Abrir y guardar notas como archivos .txt locales
   Usa la File System Access API (Chrome/Edge): "Guardar como" abre el
   selector del sistema para elegir carpeta y nombre, y "Guardar" reescribe
   el mismo archivo. Los navegadores sin esa API (Firefox, Safari) no pueden
   escribir en una ruta elegida: allí se recurre a la descarga.
   ========================================================================== */

const LIMITE_CARACTERES = 200000; // mismo límite que las reglas de Firestore
const TIPOS = [{ description: 'Archivo de texto', accept: { 'text/plain': ['.txt'] } }];
export const API_DISPONIBLE = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

/* ---------- Formato del .txt ----------
   Título: ...
   Descripción: ...
   ---
   (contenido)
*/
export function serializarNota(nota) {
  return `Título: ${nota.titulo}\nDescripción: ${nota.descripcion}\n---\n${nota.contenido}`;
}

/** Interpreta un .txt; si no tiene la cabecera, todo el texto es el contenido. */
export function interpretarTxt(texto, nombreArchivo) {
  const limpio = texto.replace(/\r\n/g, '\n');
  const m = limpio.match(/^Título: (.*)\nDescripción: (.*)\n---\n?([\s\S]*)$/);
  if (m) return { titulo: m[1], descripcion: m[2], contenido: m[3] };
  return { titulo: nombreArchivo.replace(/\.txt$/i, ''), descripcion: '', contenido: limpio };
}

/** Quita caracteres no permitidos en nombres de archivo. */
const nombreSeguro = (texto) => (texto.trim() || 'Sin título').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);

/* ---------- Abrir ---------- */
function elegirArchivoClasico() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.addEventListener('change', () => resolve(input.files[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Devuelve { nombre, texto, handle } o null si el usuario cancela. */
export async function abrirArchivo() {
  let archivo;
  let handle = null;

  if (API_DISPONIBLE) {
    try {
      [handle] = await window.showOpenFilePicker({ types: TIPOS, excludeAcceptAllOption: true, multiple: false });
      archivo = await handle.getFile();
    } catch (error) {
      if (error.name === 'AbortError') return null;
      throw error;
    }
  } else {
    archivo = await elegirArchivoClasico();
    if (!archivo) return null;
  }

  // Doble comprobación: solo .txt
  if (!/\.txt$/i.test(archivo.name)) throw new Error('Solo se pueden abrir archivos .txt.');
  const texto = await archivo.text();
  if (texto.length > LIMITE_CARACTERES) throw new Error('El archivo supera el límite de 200 000 caracteres.');
  return { nombre: archivo.name, texto, handle };
}

/* ---------- Guardar ---------- */
function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function escribir(handle, texto) {
  const flujo = await handle.createWritable();
  await flujo.write(texto);
  await flujo.close();
}

/** Guardar: reescribe el archivo original. Devuelve { descargado } según el método usado. */
export async function guardarEnArchivo(nota) {
  if (!nota.archivo) throw new Error('Esta nota aún no tiene un archivo asociado.');
  const texto = serializarNota(nota);
  if (nota.archivo.handle) {
    await escribir(nota.archivo.handle, texto);
    return { descargado: false };
  }
  descargar(nota.archivo.nombre, texto);
  return { descargado: true };
}

/** Guardar como: devuelve { nombre, handle, descargado } o null si el usuario cancela. */
export async function guardarComo(nota) {
  const texto = serializarNota(nota);
  const sugerido = `${nombreSeguro(nota.titulo)}.txt`;

  if (API_DISPONIBLE) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: sugerido, types: TIPOS });
      await escribir(handle, texto);
      return { nombre: handle.name, handle, descargado: false };
    } catch (error) {
      if (error.name === 'AbortError') return null;
      throw error;
    }
  }

  descargar(sugerido, texto);
  return { nombre: sugerido, handle: null, descargado: true };
}
