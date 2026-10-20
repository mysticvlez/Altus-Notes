/* ==========================================================================
   db.js — Cloud Firestore (colección "notas") y arranque de Firebase
   Importa el SDK modular oficial desde el CDN de Google (no se instala nada).

   La configuración de la app web es pública por diseño: la seguridad real la
   dan las reglas de Firestore y la autenticación.

   REGLAS DE SEGURIDAD (Firestore > Reglas):

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /notas/{notaId} {

         // Validación estricta de los datos que se escriben
         function datosValidos() {
           let d = request.resource.data;
           return d.keys().hasOnly(['userId','categoria','titulo','descripcion','contenido','fijada','fechaActualizacion'])
             && d.userId == request.auth.uid
             && d.categoria is string && d.categoria.size() <= 60
             && d.titulo is string && d.titulo.size() <= 200
             && d.descripcion is string && d.descripcion.size() <= 500
             && d.contenido is string && d.contenido.size() <= 200000
             && d.fijada is bool
             && d.fechaActualizacion == request.time;
         }

         // Solo el dueño (userId == UID) puede leer y borrar
         allow read, delete: if request.auth != null
                             && request.auth.uid == resource.data.userId;
         // Crear: el userId del documento debe ser el UID de quien escribe
         allow create: if request.auth != null && datosValidos();
         // Actualizar: debe ser el dueño y el userId no puede cambiar
         allow update: if request.auth != null
                       && request.auth.uid == resource.data.userId
                       && datosValidos();
       }

       // Distribución de espacios de cada usuario (un documento por UID)
       match /usuarios/{uid} {
         allow read, delete: if request.auth != null && request.auth.uid == uid;
         allow create, update: if request.auth != null && request.auth.uid == uid
           && request.resource.data.keys().hasOnly(['espacios','ordenNotas','fechaActualizacion'])
           && request.resource.data.espacios is list && request.resource.data.espacios.size() <= 60
           && request.resource.data.ordenNotas is list && request.resource.data.ordenNotas.size() <= 2000
           && request.resource.data.fechaActualizacion == request.time;
       }
     }
   }
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs, writeBatch, query, where, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAhXTptPaD61lHmjosnwJnYrNThpEByq3Y',
  authDomain: 'altus-notes.firebaseapp.com',
  projectId: 'altus-notes',
  storageBucket: 'altus-notes.firebasestorage.app',
  messagingSenderId: '512891379190',
  appId: '1:512891379190:web:9862227d380f04eef7bbd7',
};

export const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const notas = collection(firestore, 'notas');

/** Genera un id de documento sin escribir nada en la base. */
export const nuevoId = () => doc(notas).id;

/** Escucha en tiempo real SOLO las notas del usuario (la regla también lo impone). */
export function suscribirNotas(uid, alRecibir, alFallar) {
  const consulta = query(notas, where('userId', '==', uid));
  return onSnapshot(
    consulta,
    (snap) => {
      alRecibir(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            userId: x.userId,
            categoria: x.categoria,
            titulo: x.titulo,
            descripcion: x.descripcion,
            contenido: x.contenido,
            fijada: x.fijada,
            // La marca de tiempo del servidor llega nula un instante tras escribir
            fechaActualizacion: x.fechaActualizacion?.toMillis?.() ?? Date.now(),
          };
        }),
      );
    },
    alFallar,
  );
}

/** Crea o actualiza una nota con exactamente los 7 campos del modelo. */
export function guardarNota(nota) {
  return setDoc(doc(notas, nota.id), {
    userId: nota.userId,
    categoria: nota.categoria,
    titulo: nota.titulo,
    descripcion: nota.descripcion,
    contenido: nota.contenido,
    fijada: nota.fijada,
    fechaActualizacion: serverTimestamp(),
  });
}

export const eliminarNota = (id) => deleteDoc(doc(notas, id));

/* ---------- Distribución de espacios (documento usuarios/{uid}) ---------- */
const refDiseno = (uid) => doc(firestore, 'usuarios', uid);

/**
 * Escucha la distribución del usuario. Entrega null si todavía no existe.
 * Se ignoran las copias locales pendientes y las lecturas de caché vacías,
 * que no son la respuesta real del servidor.
 */
export function suscribirDiseno(uid, alRecibir, alFallar) {
  return onSnapshot(
    refDiseno(uid),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists() && snap.metadata.fromCache) return;
      const x = snap.exists() ? snap.data() : null;
      alRecibir(x ? { espacios: x.espacios, ordenNotas: x.ordenNotas } : null);
    },
    alFallar,
  );
}

export function guardarDisenoNube(uid, diseno) {
  return setDoc(refDiseno(uid), {
    espacios: diseno.espacios,
    ordenNotas: diseno.ordenNotas,
    fechaActualizacion: serverTimestamp(),
  });
}

export const eliminarDiseno = (uid) => deleteDoc(refDiseno(uid));

/** Borra todas las notas del usuario, en lotes (el límite de Firestore es 500 por lote). */
export async function eliminarTodasLasNotas(uid) {
  const snap = await getDocs(query(notas, where('userId', '==', uid)));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = writeBatch(firestore);
    snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
    await lote.commit();
  }
}
