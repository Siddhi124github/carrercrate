import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ✅ USE ENV VARIABLE (IMPORTANT)
const API_KEY = process.env.GEMINI_API_KEY;

// -------------------- BASIC SAFETY CHECK --------------------
if (!API_KEY) {
  console.error("❌ GEMINI_API_KEY missing in environment variables");
}

// -------------------- Interview System --------------------
const interviewSessions = {};
const stages = ["basic", "role", "technical", "resume", "behavioral", "salary"];

async function callGemini(prompt, maxTokens = 300) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      }
    );

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    console.error("Gemini API error:", err);
    return "";
  }
}

function getStageQuestion(stage, jobRole, resume) {
  const prompts = {
    basic: `Ask ONE HR interview question for ${jobRole}.`,
    role: `Ask ONE role-specific question for ${jobRole}.`,
    technical: `Ask ONE technical question for ${jobRole}.`,
    resume: `Resume: ${resume}\nAsk ONE resume-based question.`,
    behavioral: `Ask ONE behavioral interview question for ${jobRole}.`,
    salary: `Ask ONE salary/notice-period question for ${jobRole}.`
  };
  return prompts[stage];
}

function nextStage(stage) {
  const i = stages.indexOf(stage);
  return i < stages.length - 1 ? stages[i + 1] : null;
}

// -------------------- INTERVIEW ROUTES --------------------
app.post("/interview/start", async (req, res) => {
  const { jobRole, resumeText } = req.body;
  if (!jobRole || !resumeText) {
    return res.status(400).json({ error: "Missing data" });
  }

  const sessionId = uuidv4();
  const question = await callGemini(getStageQuestion("basic", jobRole, resumeText));

  interviewSessions[sessionId] = {
    jobRole,
    resumeText,
    currentStage: "basic",
    history: [],
    lastQuestion: question,
  };

  res.json({ sessionId, question });
});

app.post("/interview/answer", async (req, res) => {
  const { sessionId, answer } = req.body;
  const session = interviewSessions[sessionId];
  if (!session) return res.status(400).json({ error: "Invalid session" });

  session.history.push({ q: session.lastQuestion, a: answer });

  const next = nextStage(session.currentStage);
  if (!next) {
    const feedback = await callGemini(
      `Give interview feedback:\n${JSON.stringify(session.history)}`,
      600
    );
    delete interviewSessions[sessionId];
    return res.json({ feedback });
  }

  session.currentStage = next;
  session.lastQuestion = await callGemini(
    getStageQuestion(next, session.jobRole, session.resumeText)
  );

  res.json({ question: session.lastQuestion });
});

// -------------------- RESUME SUGGESTION (FIXED) --------------------
app.post("/suggest", async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: "Role required" });

    const prompt = `
Generate ONLY JSON for role "${role}":
{
  "skills": ["skill1","skill2","skill3","skill4","skill5"],
  "summary": "5 line resume summary",
  "description": "4 line job description"
}
`;

    const text = await callGemini(prompt, 300);

    let result;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON");
      result = JSON.parse(match[0]);
    } catch {
      // ✅ SAFE FALLBACK (NO CRASH)
      return res.json({
        skills: "Communication, Problem Solving, Teamwork",
        summary: `Experienced ${role} professional.`,
        description: `Worked on responsibilities related to ${role}.`
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Suggest error:", err);
    res.json({
      skills: "",
      summary: "",
      description: ""
    });
  }
});

// -------------------- CAREER AI --------------------
app.post("/career-ai", async (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: "Input required" });

  const text = await callGemini(`Give career info for ${input}`, 500);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return res.json({});

  try {
    res.json(JSON.parse(match[0]));
  } catch {
    res.json({});
  }
});

// -------------------- HEALTH CHECK --------------------
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
