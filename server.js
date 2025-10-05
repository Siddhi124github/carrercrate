import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = "AIzaSyAUOxq8xeNvl5NvmfBh2G07J2OvKO_mj40";

// -------------------- Interview System --------------------
const interviewSessions = {};
const stages = ["basic", "role", "technical", "resume", "behavioral", "salary"];

async function callGemini(prompt, maxTokens = 300) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`API responded with status: ${response.status}`);
    const data = await response.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    return text ? text.replace(/```/g, "").trim() : "Error generating response.";
  } catch (err) {
    console.error("Gemini API error:", err);
    return "Error generating response.";
  }
}

function getStageQuestion(stage, jobRole, resume) {
  const stagePrompts = {
    basic: `You are conducting the first stage of a professional interview for ${jobRole} position. Ask ONE HR question about motivation, strengths, teamwork, or interest in role. Return ONLY the question.`,
    role: `Interview for ${jobRole} role. Ask ONE specific question about role-specific skills, industry knowledge, or tools. Return ONLY the question.`,
    technical: `For ${jobRole}, ask ONE practical technical question about problem solving or hands-on skills. Return ONLY the question.`,
    resume: `CANDIDATE RESUME: ${resume}\nJOB ROLE: ${jobRole}\nAsk ONE question about projects, technologies, or achievements. Return ONLY the question.`,
    behavioral: `Ask ONE behavioral question for ${jobRole} about conflict resolution, handling difficult situations, leadership, or deadlines. Return ONLY the question.`,
    salary: `Ask ONE professional question about salary expectations, notice period, or joining timeline for ${jobRole}. Return ONLY the question.`
  };
  return stagePrompts[stage];
}

function nextStage(currentStage) {
  const idx = stages.indexOf(currentStage);
  return idx < stages.length - 1 ? stages[idx + 1] : null;
}

app.post("/interview/start", async (req, res) => {
  try {
    const { jobRole, resumeText } = req.body;
    if (!jobRole || !resumeText) return res.status(400).json({ error: "Missing jobRole or resumeText" });

    const sessionId = uuidv4();
    const stage = "basic";
    const question = await callGemini(getStageQuestion(stage, jobRole, resumeText));

    interviewSessions[sessionId] = {
      jobRole,
      resumeText,
      currentStage: stage,
      questionCount: 1,
      maxQuestions: 10,
      history: [],
      lastQuestion: question,
    };

    res.json({ sessionId, question, stage, questionCount: 1, maxQuestions: 10 });
  } catch (error) {
    console.error("Start interview error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/interview/answer", async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const session = interviewSessions[sessionId];
    if (!session) return res.status(400).json({ error: "Invalid session" });
    if (!answer) return res.status(400).json({ error: "Answer is required" });

    session.history.push({ question: session.lastQuestion, answer });
    session.questionCount++;

    if (session.currentStage === "salary" || session.questionCount > stages.length) {
      const feedbackPrompt = `INTERVIEW FEEDBACK REQUEST:\nJob Role: ${session.jobRole}\nConversation:\n${session.history.map((qa, idx) => `Q${idx+1}: ${qa.question}\nA${idx+1}: ${qa.answer}`).join("\n\n")}\nProvide structured feedback with strengths, weaknesses, suggestions, communication, and overall assessment. Return ONLY feedback.`;
      const feedback = await callGemini(feedbackPrompt, 600);
      delete interviewSessions[sessionId];
      return res.json({ feedback });
    }

    const next = nextStage(session.currentStage);
    session.currentStage = next;
    const question = await callGemini(getStageQuestion(next, session.jobRole, session.resumeText));
    session.lastQuestion = question;

    res.json({ question, questionCount: session.questionCount, stage: session.currentStage });
  } catch (error) {
    console.error("Submit answer error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/interview/clarify", async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions[sessionId];
    if (!session || !session.lastQuestion) return res.status(400).json({ error: "Invalid session or no last question" });

    const question = await callGemini(`Rephrase this interview question to be clearer while keeping the same intent: "${session.lastQuestion}"\nReturn ONLY the rephrased question.`);
    session.lastQuestion = question;

    res.json({ question });
  } catch (error) {
    console.error("Clarify question error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/interview/finish", async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = interviewSessions[sessionId];
    if (!session) return res.status(400).json({ error: "Invalid session" });

    const feedbackPrompt = `COMPREHENSIVE INTERVIEW FEEDBACK:\nPosition: ${session.jobRole}\nTotal Questions: ${session.questionCount}\nTranscript:\n${session.history.map((qa, i) => `Q${i+1}: ${qa.question}\nA${i+1}: ${qa.answer}`).join('\n\n')}\nGenerate detailed professional feedback in structured format.`;
    const feedback = await callGemini(feedbackPrompt, 700);
    delete interviewSessions[sessionId];
    res.json({ feedback });
  } catch (error) {
    console.error("Finish interview error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ------------------- /suggest route (unchanged) -------------------
app.post("/suggest", async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: "Role is required" });

    const prompt = `
Generate a JSON object for the role "${role}" with these keys:
{
  "skills": ["skill1", "skill2", "skill3", "skill4", "skill5", "skill6"],
  "description": "4-line professional description",
  "summary": "5-line resume summary"
}
Return ONLY valid JSON (no extra text).
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      }
    );

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (!text) return res.status(500).json({ error: "No response from AI" });

    let result;
    try {
      const cleanText = text.replace(/```json|```/g, "").trim();
      result = JSON.parse(cleanText);
    } catch (err) {
      console.error("❌ JSON parse failed:", err);
      return res.status(500).json({ error: "Invalid JSON from AI" });
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Error in /suggest:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------- /career-ai route (final professional JSON) -------------------
app.post("/career-ai", async (req, res) => {
  try {
    const { type, input, skills } = req.body;
    if ((!type) || (type === "career-to-skills" && !input) || (type === "skills-to-career" && (!skills || skills.length === 0))) {
      return res.status(400).json({ error: "Missing required input" });
    }

    let prompt = "";

    if (type === "skills-to-career") {
      // Skills input -> career suggestion
      prompt = `
Suggest a career path for these skills: ${skills.join(", ")}.
Return JSON only with keys:
{
  "best_fit_role": "Data Analyst",
  "why": "1-line reason why this role fits",
  "responsibilities": ["3 main responsibilities"],
  "next_skills": ["3 next skills to learn"],
  "growth_path": "short future path",
  "average_salary": "₹4–7 LPA",
  "industries": ["Finance", "E-commerce", "Healthcare"],
  "job_type": "Full-time / Remote possible",
  "entry_experience": "0–2 years",
  "courses": ["Coursera Data Analytics Professional Certificate", "Kaggle Competitions"],
  "top_companies": ["Amazon", "Accenture", "Infosys"]
}
Keep JSON concise and token-efficient (<500 tokens).
`;
    } else {
      // Role input -> career profile with degree & companies
      prompt = `
Provide a professional career profile for this role: ${input}.
Return JSON only with keys:
{
  "role": "${input}",
  "overview": "1-2 line overview of role",
  "required_degree": "Recommended degree(s)",
  "required_skills": ["3-5 technical & soft skills"],
  "soft_skills": ["3 key soft skills"],
  "career_progression": "next roles after this role",
  "average_salary": "approx salary / market demand",
  "industries": ["3-4 industries or companies"],
  "certifications": ["2-3 key certifications"],
  "top_companies": ["Amazon", "Accenture", "Infosys"]
}
Keep JSON concise and token-efficient (<500 tokens).
`;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500 },
        }),
      }
    );

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (!text) return res.status(500).json({ error: "No response from AI" });

    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      result = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("❌ JSON parse failed:", err, "Raw text:", text);
      return res.status(500).json({ error: "Invalid JSON from AI" });
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Error in /career-ai:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Other routes --------------------
app.get("/health", (req, res) => res.json({ status: "OK", message: "Server is running" }));
app.get("/", (req, res) => res.sendFile(join(__dirname, "index.html")));

// -------------------- Start server --------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`✅ Frontend available at http://localhost:${PORT}`);
});
