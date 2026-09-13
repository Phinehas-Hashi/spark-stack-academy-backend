import "dotenv/config";
import express from "express";
import cors from "cors";
import sparkAIRouter from "./routes/spark-ai.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  }
}));

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "Spark Stack Academy Backend",
    status: "online"
  });
});

app.get("/health", (_req, res) => {
  res.json({ success: true, status: "healthy" });
});

app.use("/api/spark-ai", sparkAIRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: "Backend error." });
});

app.listen(PORT, () => {
  console.log(`SSA backend listening on port ${PORT}`);
});

export { app };
