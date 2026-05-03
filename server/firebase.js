import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

let firebaseApp;
let firestoreDb;

export function getFirebaseServerConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  };
}

export function getServerDb() {
  if (!firestoreDb) {
    const config = getFirebaseServerConfig();
    const required = ["apiKey", "authDomain", "projectId", "appId"];

    for (const key of required) {
      if (!config[key]) {
        throw new Error(`Missing Firebase server config: ${key}`);
      }
    }

    firebaseApp = initializeApp(config, "server");
    firestoreDb = getFirestore(firebaseApp);
  }

  return firestoreDb;
}
