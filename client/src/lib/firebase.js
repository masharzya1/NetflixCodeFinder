import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let initPromise = null;

export async function initFirebaseClient() {
  if (firebaseApp && firebaseAuth && firebaseDb) {
    return { app: firebaseApp, auth: firebaseAuth, db: firebaseDb };
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const response = await fetch("/api/config/firebase");

    if (!response.ok) {
      throw new Error("Firebase config API failed.");
    }

    const config = await response.json();

    const required = ["apiKey", "authDomain", "projectId", "appId"];
    for (const key of required) {
      if (!config[key]) {
        throw new Error(`Firebase config missing: ${key}`);
      }
    }

    firebaseApp = initializeApp(config);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDb = getFirestore(firebaseApp);

    return { app: firebaseApp, auth: firebaseAuth, db: firebaseDb };
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
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
