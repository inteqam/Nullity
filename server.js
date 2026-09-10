import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5173;
const isProduction = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "32kb" }));

const SYSTEM_INSTRUCTION = `You are a careful classifier inside a wellbeing app called NULLITY.
Given a free-form description of someone's day, return ONLY valid JSON matching this shape:
{
  "summary": "one calm, plain sentence reflecting back the day, no clinical or diagnostic language",
  "mood": "overwhelmed|stressed|tired|anxious|okay|good|calm",
  "energy": "low|medium|high",
  "stress": "low|medium|high",
  "themes": ["1-4 lowercase snake_case tags"],
  "goal": "reset_and_prepare|slow_down|clear_head|regain_focus|unwind"
}
Never diagnose. Never name a mental health condition. Never suggest medication or treatment.
Do not create an activity or intervention. NULLITY's application owns the activity library.`;

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    mood: { type: "string", enum: ["overwhelmed","stressed","tired","anxious","okay","good","calm"] },
    energy: { type: "string", enum: ["low","medium","high"] },
    stress: { type: "string", enum: ["low","medium","high"] },
    themes: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
    goal: { type: "string", enum: ["reset_and_prepare","slow_down","clear_head","regain_focus","unwind"] }
  },
  required: ["summary","mood","energy","stress","themes","goal"],
  additionalProperties: false
};

app.post("/api/classify", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Check-in text is required." });
    if (text.length > 12000) return res.status(413).json({ error: "Check-in is too long." });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Gemini is not configured." });
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      contents: `${SYSTEM_INSTRUCTION}\n\nUser check-in:\n${text}`,
      config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2, maxOutputTokens: 500 }
    });
    const raw = response.text?.trim();
    if (!raw) throw new Error("Gemini returned an empty response.");
    res.json(JSON.parse(raw));
  } catch (error) {
    console.error("Gemini classification error:", error);
    res.status(502).json({ error: "Gemini classification failed. NULLITY will use its local fallback." });
  }
});

let screeningModel = null;
try {
  const modelPath = path.join(__dirname, "ml", "screening_model.json");
  if (fs.existsSync(modelPath)) screeningModel = JSON.parse(fs.readFileSync(modelPath, "utf8"));
} catch (e) { console.error("Could not load screening model:", e); }

app.post("/api/screening/predict", (req, res) => {
  try {
    if (!screeningModel) return res.status(503).json({ error: "Screening model is not configured." });
    const scores = req.body?.scores;
    if (!Array.isArray(scores) || scores.length !== screeningModel.features.length) {
      return res.status(400).json({ error: `Expected ${screeningModel.features.length} screening scores.` });
    }
    const x = scores.map(Number);
    if (x.some(v => !Number.isFinite(v) || v < 0 || v > 3)) return res.status(400).json({ error: "Each screening score must be between 0 and 3." });
    const z = screeningModel.intercept + x.reduce((sum, v, i) => sum + screeningModel.coefficients[i] * v, 0);
    const probability = 1 / (1 + Math.exp(-z));
    const threshold = screeningModel.threshold ?? 0.5;
    res.json({
      riskProbability: Number(probability.toFixed(4)),
      riskPercent: Math.round(probability * 100),
      elevatedRiskSignal: probability >= threshold,
      model: screeningModel.name,
      disclaimer: "This is a demonstration screening signal, not a diagnosis or medical assessment."
    });
  } catch (error) {
    console.error("Screening prediction error:", error);
    res.status(500).json({ error: "Screening prediction failed." });
  }
});

async function start() {
  if (isProduction) {
    const dist = path.join(__dirname, "dist");
    app.use(express.static(dist));
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      if (!fs.existsSync(path.join(dist, "index.html"))) return res.status(503).send("NULLITY is not built yet. Run npm run build first.");
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  app.listen(PORT, () => console.log(`NULLITY running at http://localhost:${PORT}`));
}

start();
