import { getFirebaseAuth } from "../config/firebase.js";

export async function requireFirebaseUser(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing Firebase ID token."
      });
    }

    const idToken = header.slice(7).trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: "Missing Firebase ID token."
      });
    }

    const decodedToken = await getFirebaseAuth().verifyIdToken(idToken);
    req.firebaseUser = decodedToken;

    next();
  } catch (error) {
    console.error("Firebase auth error:", error.message);
    return res.status(401).json({
      success: false,
      error: "Invalid or expired Firebase ID token."
    });
  }
}
