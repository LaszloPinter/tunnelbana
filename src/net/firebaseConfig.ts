/**
 * The web app's Firebase config, fetched with
 * `firebase apps:sdkconfig WEB` and committed on purpose.
 *
 * These values are PUBLIC by design, they ship inside the bundle of every
 * Firebase web app, and Google documents them as identifiers rather than
 * secrets. What stops a stranger writing whatever they like is firestore.rules,
 * not the obscurity of an apiKey. Read that file before trusting this one.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB7JLzwgendrFVQEfnez2kKpztEJdLkHpA',
  authDomain: 'tunnelbana-ec849.firebaseapp.com',
  projectId: 'tunnelbana-ec849',
  storageBucket: 'tunnelbana-ec849.firebasestorage.app',
  messagingSenderId: '620112587000',
  appId: '1:620112587000:web:0cb3b66121d672fbee730d',
} as const;
