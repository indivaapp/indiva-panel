
// =================================================================================
// Firebase App (the core Firebase SDK) is always required and must be listed first
// =================================================================================

// Import the functions you need from the SDKs you need
import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB4sjujBvM9WwvrsIllRAsP3EhPDkjmMCs",
  authDomain: "indiva-expo.firebaseapp.com",
  projectId: "indiva-expo",
  storageBucket: "indiva-expo.firebasestorage.app",
  messagingSenderId: "905697488486",
  appId: "1:905697488486:web:befb0b4655584dc04b07a7"
};

// Tekil app instance garantisi
export const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Geliştirici uyarıları (yer tutucu/boş kontrolü)
const hasPlaceholder = Object.values(firebaseConfig).some(v => typeof v === "string" && v.includes("<<<"));
if (hasPlaceholder) {
  console.error("🔥 firebaseConfig içinde yer tutucu (<<<...>>>) kaldı. Project Settings > General > Web App config'ten gerçek değerleri koymalısınız.");
}
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.trim() === "") {
  console.error("🔥 Firebase apiKey boş görünüyor. Web (</>) uygulamasının API key'ini kullanın.");
}