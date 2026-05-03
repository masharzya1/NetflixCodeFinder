import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;

export async function initFirebaseClient() {
  if (firebaseApp) {
    return { app: firebaseApp, auth: firebaseAuth, db: firebaseDb };
  }

  const response = await fetch("/api/config/firebase");
  if (!response.ok) {
    throw new Error("Sign-in is temporarily unavailable. Please try again later.");
  }

  const config = await response.json();
  firebaseApp = initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  firebaseDb = getFirestore(firebaseApp);

  return { app: firebaseApp, auth: firebaseAuth, db: firebaseDb };
}

export function getFirebaseAuth() {
  if (!firebaseAuth) {
    throw new Error("Firebase is not initialized yet.");
  }
  return firebaseAuth;
}

export function getGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
