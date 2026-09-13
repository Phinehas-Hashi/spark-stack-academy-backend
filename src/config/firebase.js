import admin from "firebase-admin";

export function getFirebaseApp() {
  if (admin.apps.length) return admin.app();

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error("Firebase Admin environment variables are missing.");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

export function getFirebaseAuth() {
  return getFirebaseApp() && admin.auth();
}

export function getFirestore() {
  return getFirebaseApp() && admin.firestore();
}
