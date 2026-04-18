# 🎓 AdmissionAI — AI-Based College Selection System

> Predict your engineering admission chances across IITs, NITs, BITS, IIITs and top private colleges using real JoSAA cutoff data and AI-powered insights.

🔗 **Live Demo:** https://admissionai-frontend.vercel.app

---

## ✨ Features

- **JEE & EAMCET support** — separate prediction engines for both exams
- **Real cutoff data** — JoSAA closing ranks from 2021–2025 (144 institutes)
- **AI Counselor** — Mistral-7B powered chatbot with your college context loaded
- **Priority filters** — rank colleges by Placements, Research, Infra, or Affordability
- **Dashboard layout** — colleges, charts, insights and chat in one view, no scrolling
- **Dream / Moderate / Safe** categorization with animated probability bars

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (React), deployed on Vercel |
| Backend | Node.js + Express, deployed on Render |
| AI | Featherless API — Mistral-7B-Instruct-v0.2 |
| Data | JoSAA 2021–2025 CSV → cutoffs.json |

---

## 🚀 Run Locally

### Backend
```bash
cd backend
npm install
# Create .env file:
# FEATHERLESS_KEY=your_key_here
node server.js
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

---

## 📁 Project Structure
