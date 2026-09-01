import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, onAuthStateChanged, updateProfile } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const missingFirebaseConfig = !firebaseConfig.apiKey || !firebaseConfig.projectId

export const app = missingFirebaseConfig ? null : initializeApp(firebaseConfig)
export const auth = missingFirebaseConfig ? null : getAuth(app)
export const db = missingFirebaseConfig ? null : getFirestore(app)

export function watchAuth(callback) {
  if (!auth) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function ensureSignedIn(displayName) {
  if (!auth) throw new Error('Firebase is not configured. Add your keys to .env')
  if (!auth.currentUser) {
    const cred = await signInAnonymously(auth)
    if (displayName) {
      await updateProfile(cred.user, { displayName })
    }
    return cred.user
  }
  if (displayName && auth.currentUser.displayName !== displayName) {
    await updateProfile(auth.currentUser, { displayName })
  }
  return auth.currentUser
}
