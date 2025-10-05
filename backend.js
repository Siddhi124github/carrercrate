import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config(); // load .env

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Test route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Career API endpoint
app.post("/api/career", async (req, res) => {
  const { type, userInput, skills } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "API key not found in env" });
  }

  let prompt = "";
  if (type === "skills-to-career") {
    if (!skills || skills.length === 0) {
      return res.status(400).json({ error: "Skills are required" });
    }
    prompt = `Suggest 5 career paths for someone with these skills: ${skills.join(
      ", "
    )}`;
  } else if (type === "career-to-skills") {
    if (!userInput || userInput.trim() === "") {
      return res.status(400).json({ error: "Career input is required" });
    }
    prompt = `List required skills, education, certifications, experience, and average salary for a ${userInput}`;
  } else {
    return res.status(400).json({ error: "Invalid type" });
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content:
                "You are a career advisor. Suggest jobs, skills, degrees, industries, and salary based on user input.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 500,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    res.json({ result: data.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error, check console" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
