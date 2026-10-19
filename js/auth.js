/* ==========================================================================
   auth.js — Firebase Authentication (correo y contraseña)
   La contraseña solo se conserva en memoria durante la sesión de esta
   pestaña (para mostrarla en Configuración y para confirmar el borrado de
   la cuenta); nunca se guarda en disco ni se envía a otro lugar.
   ========================================================================== */

import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { app } from './db.js';

const auth = getAuth(app);
let claveEnMemoria = null;

// Mensajes en español para los errores más comunes de Firebase
const MENSAJES = {
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
  'auth/requires-recent-login': 'Vuelve a iniciar sesión para continuar.',
};

/** Ejecuta una acción de Firebase y traduce su error a un mensaje legible. */
async function conTraduccion(accion, mensajes = MENSAJES) {
  try {
    return await accion();
  } catch (error) {
    throw new Error(mensajes[error.code] ?? MENSAJES[error.code] ?? 'No se pudo completar la operación.');
  }
}

/** Avisa cada vez que la sesión cambia; entrega { uid, email } o null. */
export function observarSesion(alCambiar) {
  return onAuthStateChanged(auth, (usuario) => {
    if (!usuario) claveEnMemoria = null;
    alCambiar(usuario ? { uid: usuario.uid, email: usuario.email } : null);
  });
}

export async function registrar(email, password) {
  await conTraduccion(() => createUserWithEmailAndPassword(auth, email, password));
  claveEnMemoria = password;
}

export async function iniciarSesion(email, password) {
  await conTraduccion(() => signInWithEmailAndPassword(auth, email, password));
  claveEnMemoria = password;
}

export async function cerrarSesion() {
  await conTraduccion(() => signOut(auth));
  claveEnMemoria = null;
}

/** Contraseña de esta sesión, o null si la sesión se restauró sin iniciar sesión aquí. */
export const claveDeSesion = () => claveEnMemoria;

/** Confirma la identidad antes de una operación sensible. */
export function reautenticar(password) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('No hay una sesión activa.');
  return conTraduccion(
    () => reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, password)),
    { 'auth/invalid-credential': 'La contraseña no es correcta.', 'auth/wrong-password': 'La contraseña no es correcta.' },
  );
}

/** Elimina la cuenta de autenticación del usuario actual. */
export async function eliminarUsuario() {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('No hay una sesión activa.');
  await conTraduccion(() => deleteUser(usuario));
  claveEnMemoria = null;
}
