# NULLITY

**Make space for what matters.**

NULLITY is a voice-first wellbeing and self-reflection web app. Instead of another wall of generic advice, it turns a user's own description of their day into a structured understanding of their state and one small, doable action — then tracks how that action actually affected them over time.

## The idea

Most wellness apps ask you to fill out mood-tracker forms. NULLITY asks one question — **"How was your day?"** — lets you answer by voice or text in your own words, and does the structuring for you:

```
Check-in → Understand → Plan → Do → Reflect → Track → (repeat, smarter each time)
```

- **Check-in** — speak or type freely, no forced questionnaire
- **Understand** — an LLM (Gemini) converts the unstructured description into a structured state: mood, energy, stress, themes, and a goal — with a deterministic local fallback if the API is unavailable, so the app never breaks on a network hiccup
- **Plan** — the model does *not* invent interventions. It picks from a small, curated, human-authored activity library (breathing, guided reflection, tiny focus sessions), so behavior stays predictable and testable
- **Do** — a short, timed activity, designed to be finishable in a few minutes
- **Reflect** — a quick before/after self-rating, so the app measures impact instead of assuming it
- **Track** — a dashboard of mood/energy/stress trends, recurring themes, streaks, and session history

An experimental **ML screening layer** (logistic regression over structured wellbeing signals) is included separately, explicitly framed as a screening/awareness signal — never a diagnosis.

## Tech stack

- **Frontend:** React 19 + Vite 7, Tailwind CSS 4
- **Backend:** Express 5 (serves the built frontend + a small API surface)
- **AI:** Google Gemini, via `@google/genai`, for check-in interpretation — with a rule-based local fallback classifier
- **Auth:** Firebase Authentication (Google, phone OTP, email/password) — entirely optional; the app works fully as a guest
- **Persistence:** `localStorage`, namespaced per guest/account
- **ML:** a small logistic-regression screening model, trainable via a Python script over a synthetic demo dataset

## Getting started

```bash
npm install
cp .env.example .env      # optional — the app runs fine with this left mostly blank
npm run dev
```

Then open `http://localhost:5173`.

- Leave `.env` blank and the app still works: no Gemini key → falls back to local classification; no Firebase config → runs in guest-only mode.
- To enable real AI classification, add `GEMINI_API_KEY` to `.env`.
- To enable Google/phone/email sign-in, create a Firebase project, enable those providers under Authentication → Sign-in method, and copy the Web App config's `VITE_FIREBASE_*` values into `.env`.

Production build:

```bash
npm run build
npm start
```

Retrain the demo ML screening model:

```bash
npm run train:screening
```

## Design principles

1. **Conversation over questionnaires** — let people describe themselves in their own words
2. **AI for understanding, not unrestricted decision-making** — the LLM structures input; a fixed activity library decides interventions
3. **Small actions over generic advice** — one realistic thing to do right now, not a life overhaul
4. **Progress over one-off interactions** — every check-in feeds a longitudinal record
5. **Screening over diagnosis** — the ML layer flags patterns worth attention; it never labels a condition

## Current status / known limitations

Being upfront about where this stands:

- The core loop (check-in → understand → plan → do → reflect → track) is fully implemented and working end to end.
- Authentication currently provides **continuity within a browser**, not true cross-device sync — Firebase handles identity, but history lives in `localStorage`, not a synced backend. Multi-device sync would need a real datastore (e.g. Firestore) behind it.
- The ML screening layer is a working prototype trained on a **synthetic demo dataset** — not clinically validated, and is presented as a screening signal only, never a diagnosis.
- Longitudinal pattern-surfacing ("you've mentioned academic pressure several times this week") is partially wired — theme frequency is tracked, but proactive nudges from it aren't fully built yet.

## Safety

NULLITY is a wellness and self-reflection tool, not a replacement for a mental-health professional. It includes basic crisis-language detection on check-in text as a safety net, and never presents its ML screening output as a clinical diagnosis.
