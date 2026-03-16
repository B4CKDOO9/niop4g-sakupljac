// Prevent Firebase from detecting Electron's renderer as a Node.js environment.
delete window.module;

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeFirestore, persistentLocalCache }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDQVl0NbQLR9tAVsUaEZa3wjrk6jwD47C0",
  authDomain:        "niop4g-sakupljac.firebaseapp.com",
  projectId:         "niop4g-sakupljac",
  storageBucket:     "niop4g-sakupljac.firebasestorage.app",
  messagingSenderId: "459725265628",
  appId:             "1:459725265628:web:1bbbdf3666cf5ad585f219"
};

const app = initializeApp(firebaseConfig);

// persistentLocalCache enables offline support:
// reads serve from IndexedDB cache, writes queue and sync when back online
export const db   = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth = getAuth(app);