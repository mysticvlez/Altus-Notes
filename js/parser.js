/* ==========================================================================
   parser.js — Formato estilo WhatsApp
     *texto*   -> <strong>      _texto_  -> <em>
     ~texto~   -> <del>         ```texto``` -> <code>

   Dos salidas:
   - parsearFormato: HTML limpio, sin los delimitadores.
   - parsearEnVivo:  conserva los delimitadores (atenuados) para que la capa
                     de formato del editor coincida letra por letra con el
                     texto que se escribe.

   Seguridad: el texto se ESCAPA antes de formatear, así que el resultado solo
   puede contener las etiquetas de formato (sin riesgo de XSS).
   ========================================================================== */

// Carácter nulo usado como marcador temporal para proteger bloques de código
const MARCA = '\u0000';

/** Convierte caracteres especiales de HTML en entidades. */
export function escaparHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/*
  Reglas de formato: [patrón, etiqueta, delimitador].
  Como en WhatsApp, el delimitador debe estar pegado al texto (sin espacios
  dentro) y no estar pegado a otras letras por fuera, para que cosas como
  snake_case o 2*3*4 no se formateen por accidente.
*/
const REGLAS = [
  [/(?<![\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])/g, 'strong', '*'],
  [/(?<![\w_])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![\w_])/g, 'em', '_'],
  [/(?<![\w~])~(?![\s~])([^~\n]+?)(?<![\s~])~(?![\w~])/g, 'del', '~'],
];

/** Delimitador atenuado (solo en la salida en vivo). */
const atenuar = (delimitador) => `<span class="marca">${delimitador}</span>`;

function aplicar(texto, enVivo) {
  const bloques = [];

  // 1) Escapar y quitar cualquier marcador nulo que viniera en el texto
  let html = escaparHtml(String(texto).replace(/\u0000/g, ''));

  // 2) Extraer bloques ```código``` para que su interior no se formatee
  html = html.replace(/```([\s\S]+?)```/g, (_, codigo) => {
    bloques.push(codigo);
    return `${MARCA}${bloques.length - 1}${MARCA}`;
  });

  // 3) Aplicar negrita, cursiva y tachado
  for (const [patron, etiqueta, delimitador] of REGLAS) {
    html = html.replace(patron, (_, interior) =>
      enVivo
        ? `<${etiqueta}>${atenuar(delimitador)}${interior}${atenuar(delimitador)}</${etiqueta}>`
        : `<${etiqueta}>${interior}</${etiqueta}>`);
  }

  // 4) Devolver los bloques de código ya envueltos en <code>
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) =>
    enVivo
      ? `<code>${atenuar('```')}${bloques[Number(i)]}${atenuar('```')}</code>`
      : `<code>${bloques[Number(i)]}</code>`);
}

/** HTML seguro con el formato aplicado y sin delimitadores. */
export const parsearFormato = (texto) => aplicar(texto, false);

/** HTML seguro con el formato aplicado y los delimitadores visibles (atenuados). */
export const parsearEnVivo = (texto) => aplicar(texto, true);
