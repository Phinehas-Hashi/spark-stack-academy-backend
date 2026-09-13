import express from "express";
import { getFirestore } from "../config/firebase.js";
import { requireFirebaseUser } from "../middleware/auth.js";
import { generateSparkAI } from "../services/groq.js";

const router = express.Router();

function isAuthorizedFounder(data) {
  return data?.role === "founder" &&
    data?.active === true &&
    data?.verified === true &&
    data?.status === "active";
}

router.post("/", requireFirebaseUser, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const founderSnapshot = await getFirestore().collection("founder").doc(uid).get();

    if (!founderSnapshot.exists || !isAuthorizedFounder(founderSnapshot.data())) {
      return res.status(403).json({
        success: false,
        error: "Spark AI access is not authorized for this account."
      });
    }

    const messages = req.body?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "messages must be a non-empty array."
      });
    }

    const safeMessages = messages.slice(-50).map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 12000)
    })).filter((message) => message.content.trim());

    if (!safeMessages.length) {
      return res.status(400).json({
        success: false,
        error: "No valid messages were provided."
      });
    }

    const result = await generateSparkAI(safeMessages);

    return res.json({
      success: true,
      reply: result.reply,
      model: result.model
    });
  } catch (error) {
    console.error("Spark AI error:", error);
    return res.status(500).json({
      success: false,
      error: "Spark AI request failed."
    });
  }
});

export default router;
