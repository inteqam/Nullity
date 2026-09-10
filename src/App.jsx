import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Keyboard, Square, Check, ArrowLeft, RotateCcw, Play, Pause, User, LogOut, ShieldCheck, Chrome, Smartphone, Mail, LockKeyhole } from "lucide-react";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth, firebaseConfigured } from "./firebase";

/* =========================================================================
   NULLITY — a quiet, voice-first reflection tool.
   Single-file React artifact. Tailwind for layout/spacing utilities only;
   color, type, and motion are custom (defined in the <style> block below)
   since this environment doesn't support arbitrary Tailwind values.
   ========================================================================= */

/* ---------------------------- Design tokens ----------------------------- */
const COLORS = {
  bg: "#0A0A09",
  surface: "#131211",
  surfaceHover: "#181715",
  border: "rgba(237,234,227,0.09)",
  borderStrong: "rgba(237,234,227,0.16)",
  textPrimary: "#EDEAE3",
  textSecondary: "#8C887F",
  textFaint: "#5C5952",
  accent: "#C9A876",
  accentDim: "rgba(201,168,118,0.14)",
  accentText: "#DDC49A",
};

/* ----------------------------- Activity library -------------------------
   The application — not the model — owns what activities exist, how long
   they run, and what they look like. The AI only helps rank/select among
   them. This keeps behavior predictable and testable. */
const ACTIVITY_LIBRARY = [
  {
    id: "breathing",
    type: "breathing",
    title: "Breathe",
    subtitle: "Slow down",
    minutesLabel: "3 min",
    duration: 180,
    suitableFor: ["stress", "high_stress", "overwhelmed", "anxious", "tense", "racing_thoughts"],
  },
  {
    id: "reflection",
    type: "reflection",
    title: "Clear your thoughts",
    subtitle: "Put it into words",
    minutesLabel: "5 min",
    duration: 300,
    suitableFor: ["overwhelmed", "mental_fatigue", "low", "anxious", "racing_thoughts", "relationship_tension"],
  },
  {
    id: "focus",
    type: "focus",
    title: "One thing",
    subtitle: "Choose what you can control",
    minutesLabel: "10 min",
    duration: 600,
    suitableFor: ["procrastination", "low_focus", "academic_pressure", "work_pressure", "tired", "low_energy"],
  },
];

/* ----------------------------- Safety gating -----------------------------
   A short, generic phrase check that routes to a calm, resource-forward
   screen instead of a generated plan. This is a boundary, not a feature —
   kept deliberately simple for the MVP. */
const CRISIS_PHRASES = [
  "kill myself", "suicide", "end my life", "want to die",
  "ending it all", "self harm", "hurt myself", "no reason to live",
];
function containsCrisisLanguage(text) {
  // Normalize hyphens/underscores/extra whitespace so phrasing like
  // "self-harm" or "self   harm" still matches "self harm".
  const t = text.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  return CRISIS_PHRASES.some((p) => t.includes(p));
}

/* ------------------------- Deterministic fallback ------------------------
   Always available, zero network dependency. This is the real safety net
   the LLM path falls back to — not a decorative afterthought. */
function classifyLocally(text) {
  const t = text.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  let stress = "medium";
  if (has("stressed", "overwhelmed", "anxious", "pressure", "deadline", "worried", "panic", "dread")) stress = "high";
  else if (has("relaxed", "calm", "fine", "easy", "peaceful")) stress = "low";

  let energy = "medium";
  if (has("exhausted", "tired", "drained", "wiped", "no energy", "sleepy", "burnt out")) energy = "low";
  else if (has("energized", "wired", "restless", "pumped")) energy = "high";

  const themes = [];
  if (has("assignment", "exam", "deadline", "study", "class", "school")) themes.push("academic_pressure");
  if (has("work", "meeting", "boss", "project", "email")) themes.push("work_pressure");
  if (has("procrastinat", "put off", "kept avoiding")) themes.push("procrastination");
  if (has("tired", "exhausted", "drained", "sleep")) themes.push("mental_fatigue");
  if (has("argue", "fight", "conflict", "annoyed at")) themes.push("relationship_tension");
  if (has("focus", "distracted", "couldn't concentrate")) themes.push("low_focus");
  if (has("worried", "anxious", "nervous", "on edge")) themes.push("anxiety");
  if (themes.length === 0) themes.push("general_day");

  let mood = "okay";
  if (stress === "high" && energy === "low") mood = "overwhelmed";
  else if (stress === "high") mood = "stressed";
  else if (energy === "low") mood = "tired";
  else if (has("good", "great", "proud", "happy", "productive")) mood = "good";

  let goal = "slow_down";
  if (mood === "overwhelmed" || mood === "stressed") goal = "reset_and_prepare";
  else if (mood === "tired") goal = "unwind";
  else if (themes.includes("anxiety")) goal = "clear_head";
  else if (themes.includes("procrastination") || themes.includes("low_focus")) goal = "regain_focus";

  const summary =
    mood === "overwhelmed" ? "You sound like you're carrying a lot right now." :
    mood === "stressed" ? "It sounds like today had real pressure in it." :
    mood === "tired" ? "It sounds like today took a lot out of you." :
    mood === "good" ? "It sounds like today had some good in it." :
    "It sounds like a pretty ordinary, mixed day.";

  return { summary, mood, energy, stress, themes: themes.slice(0, 4), goal };
}

/* ----------------------------- LLM classification -------------------------
   Real model call. Validated before use; any failure (network, parse,
   malformed schema) falls straight through to the local classifier so the
   product never breaks on the model layer. */
async function classifyWithLLM(text) {
  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    let message = "Gemini request failed";
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }

  const parsed = await res.json();

  const validMoods = ["overwhelmed", "stressed", "tired", "anxious", "okay", "good", "calm"];
  const validLevels = ["low", "medium", "high"];
  const validGoals = ["reset_and_prepare", "slow_down", "clear_head", "regain_focus", "unwind"];

  if (
    !parsed || typeof parsed.summary !== "string" ||
    !validMoods.includes(parsed.mood) ||
    !validLevels.includes(parsed.energy) ||
    !validLevels.includes(parsed.stress) ||
    !Array.isArray(parsed.themes) || parsed.themes.length === 0 ||
    !validGoals.includes(parsed.goal)
  ) {
    throw new Error("Malformed Gemini classification schema");
  }

  return {
    summary: parsed.summary,
    mood: parsed.mood,
    energy: parsed.energy,
    stress: parsed.stress,
    themes: parsed.themes.slice(0, 4),
    goal: parsed.goal,
  };
}

async function classifyCheckIn(text) {
  try {
    return { ...(await classifyWithLLM(text)), source: "llm" };
  } catch (e) {
    return { ...classifyLocally(text), source: "local" };
  }
}

/* ------------------------------ Plan selection ---------------------------
   Pure app logic — ranks the fixed activity library against the extracted
   state. The model never invents an activity. */
function selectPlan(state) {
  const tagPool = [
    state.mood, `${state.energy}_energy`, `${state.stress}_stress`, ...state.themes,
  ];
  const scored = ACTIVITY_LIBRARY.map((a) => {
    const score = a.suitableFor.filter((tag) => tagPool.includes(tag)).length;
    return { ...a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function activityBlurb(activity, state) {
  const theme = state.themes[0]?.replace(/_/g, " ");
  if (activity.id === "breathing") return theme ? `A short reset before ${theme} follows you into tomorrow.` : "A short reset, nothing more.";
  if (activity.id === "reflection") return "Get it out of your head and onto the page.";
  if (activity.id === "focus") return "Not everything — just one thing you can actually finish.";
  return "";
}

/* --------------------------------- Storage -------------------------------
   Browser-local persistence using standard localStorage. One key, whole-state read/write. */
const STORAGE_KEY = "nullity-data-v2";
function userStorageKey(id) {
  return `${STORAGE_KEY}:${String(id || GUEST_ID).trim()}`;
}
const EMPTY_DATA = { xp: 0, streak: 0, lastActiveDate: null, checkIns: [], sessions: [] };

async function loadData(id) {
  try {
    const result = window.localStorage.getItem(userStorageKey(id));
    if (!result) return { ...EMPTY_DATA };
    const parsed = JSON.parse(result);
    return { ...EMPTY_DATA, ...parsed };
  } catch (e) {
    return { ...EMPTY_DATA };
  }
}
async function saveData(id, data) {
  try {
    window.localStorage.setItem(userStorageKey(id), JSON.stringify(data));
  } catch (e) {
    /* best-effort; app still works in-memory for this session */
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function bumpStreak(data) {
  const today = todayStr();
  if (data.lastActiveDate === today) return data;
  let streak = 1;
  if (data.lastActiveDate) {
    const gap = daysBetween(data.lastActiveDate, today);
    if (gap === 1) streak = data.streak + 1;
  }
  return { ...data, streak, lastActiveDate: today };
}


/* ---------------------------------- UI bits ------------------------------- */

function Disclaimer({ compact }) {
  return (
    <p style={{ color: COLORS.textFaint }} className={compact ? "text-[11px] leading-relaxed" : "text-xs leading-relaxed"}>
      NULLITY is a wellness and reflection tool, not a medical or mental-health treatment service.
    </p>
  );
}

function RatingScale({ value, onChange, lowLabel = "Very low", highLabel = "Very good" }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className="flex-1 rounded-full transition-all duration-200"
            style={{
              height: 44,
              border: `1px solid ${value === n ? COLORS.accent : COLORS.border}`,
              background: value === n ? COLORS.accentDim : "transparent",
              color: value === n ? COLORS.accentText : COLORS.textSecondary,
              fontSize: 15,
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-xs" style={{ color: COLORS.textFaint }}>{lowLabel}</span>
        <span className="text-xs" style={{ color: COLORS.textFaint }}>{highLabel}</span>
      </div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl py-4 text-[15px] transition-all duration-200"
      style={{
        background: disabled ? COLORS.surface : COLORS.accent,
        color: disabled ? COLORS.textFaint : "#141210",
        opacity: disabled ? 0.6 : 1,
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, style }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl py-4 text-[15px] transition-colors duration-200"
      style={{
        background: "transparent",
        color: COLORS.textSecondary,
        border: `1px solid ${COLORS.border}`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function BackRow({ onBack, label }) {
  return (
    <button onClick={onBack} className="flex items-center gap-2 mb-8 opacity-70 hover:opacity-100 transition-opacity" style={{ color: COLORS.textSecondary }}>
      <ArrowLeft size={16} />
      <span className="text-sm">{label || "Back"}</span>
    </button>
  );
}

function Sparkline({ points }) {
  if (points.length < 2) {
    return <div className="text-sm py-6 text-center" style={{ color: COLORS.textFaint }}>Not enough sessions yet to show a trend.</div>;
  }
  const w = 320, h = 80, pad = 8;
  const xs = points.map((_, i) => pad + (i * (w - pad * 2)) / (points.length - 1));
  const ys = points.map((p) => h - pad - ((p.value - 1) / 4) * (h - pad * 2));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 90 }}>
      <path d={path} fill="none" stroke={COLORS.accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={i === xs.length - 1 ? 3 : 2} fill={i === xs.length - 1 ? COLORS.accent : COLORS.textFaint} />
      ))}
    </svg>
  );
}

/* -------------------------------- Screens --------------------------------- */


const GUEST_ID = "guest";

function AuthScreen({ onAuthenticated, onContinueGuest }) {
  const [mode, setMode] = useState("login");
  const [method, setMethod] = useState("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    try { window.__nullityRecaptcha?.clear?.(); } catch {}
  }, []);

  function friendlyError(e) {
    const map = {
      "auth/invalid-credential": "The sign-in details are not correct.",
      "auth/email-already-in-use": "That email is already registered.",
      "auth/weak-password": "Use a stronger password (at least 6 characters).",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/too-many-requests": "Too many attempts. Please wait a little and try again.",
      "auth/invalid-verification-code": "That OTP is not correct.",
      "auth/code-expired": "That OTP has expired. Request a new one.",
    };
    return map[e?.code] || e?.message || "Authentication failed. Please try again.";
  }

  async function emailSubmit(e) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (!email.trim()) throw new Error("Enter your email address.");
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter your name.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        try { await sendEmailVerification(credential.user); } catch {}
        onAuthenticated(credential.user, name.trim());
        setNotice("Account created. We sent a verification email if your provider allows it.");
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        onAuthenticated(credential.user);
      }
    } catch (e) { setError(e.message?.startsWith("Enter ") || e.message?.startsWith("Password ") ? e.message : friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function googleSignIn() {
    setError(""); setNotice(""); setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      onAuthenticated(credential.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function sendOtp() {
    setError(""); setNotice(""); setBusy(true);
    try {
      if (!phone.trim()) throw new Error("Enter your phone number with country code, e.g. +91XXXXXXXXXX.");
      if (!window.__nullityRecaptcha) {
        window.__nullityRecaptcha = new RecaptchaVerifier(auth, "nullity-recaptcha", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(auth, phone.trim(), window.__nullityRecaptcha);
      setConfirmation(result);
      setNotice("OTP sent. Enter the code you received by SMS.");
    } catch (e) {
      try { window.__nullityRecaptcha?.clear?.(); window.__nullityRecaptcha = null; } catch {}
      setError(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      if (!otp.trim()) throw new Error("Enter the OTP.");
      const credential = await confirmation.confirm(otp.trim());
      onAuthenticated(credential.user);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    setError(""); setNotice("");
    if (!email.trim()) return setError("Enter your email first, then choose reset password.");
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("Password reset instructions have been sent to your email.");
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const unavailable = !firebaseConfigured;

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 rounded-2xl flex items-center justify-center" style={{ width: 52, height: 52, border: `1px solid ${COLORS.borderStrong}`, background: COLORS.surface }}>
            <ShieldCheck size={21} color={COLORS.accentText} />
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, color: COLORS.textPrimary }}>NULLITY</h1>
          <p className="mt-2 text-sm" style={{ color: COLORS.textSecondary }}>Save your journey across devices — if you want to.</p>
        </div>

        {unavailable && (
          <div className="mb-4 rounded-xl p-3 text-xs leading-relaxed" style={{ background: COLORS.accentDim, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}>
            Online authentication is not configured in this copy yet. You can still continue without an account.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button disabled={unavailable || busy} onClick={googleSignIn} className="rounded-xl py-3 flex items-center justify-center gap-2 text-sm" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, opacity: unavailable ? .5 : 1 }}><Chrome size={16}/> Google</button>
          <button disabled={unavailable || busy} onClick={() => { setMethod("phone"); setError(""); setNotice(""); }} className="rounded-xl py-3 flex items-center justify-center gap-2 text-sm" style={{ background: method === "phone" ? COLORS.accentDim : COLORS.surface, border: `1px solid ${method === "phone" ? COLORS.accent : COLORS.border}`, color: COLORS.textPrimary, opacity: unavailable ? .5 : 1 }}><Smartphone size={16}/> Phone OTP</button>
        </div>

        <div className="flex items-center gap-3 my-4"><div className="h-px flex-1" style={{ background: COLORS.border }}/><span className="text-[10px] uppercase tracking-widest" style={{ color: COLORS.textFaint }}>or email</span><div className="h-px flex-1" style={{ background: COLORS.border }}/></div>

        {method === "phone" ? (
          <div className="space-y-3">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (+91...)" autoComplete="tel" className="w-full rounded-xl px-4 py-3.5 outline-none" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }} />
            {confirmation && <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" inputMode="numeric" autoComplete="one-time-code" className="w-full rounded-xl px-4 py-3.5 outline-none" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }} />}
            <div id="nullity-recaptcha" />
            <PrimaryButton onClick={confirmation ? verifyOtp : sendOtp} disabled={unavailable || busy}>{busy ? "Please wait…" : confirmation ? "Verify OTP" : "Send OTP"}</PrimaryButton>
            {confirmation && <button onClick={() => { setConfirmation(null); setOtp(""); setNotice(""); }} className="w-full text-xs" style={{ color: COLORS.textFaint }}>Use a different number</button>}
          </div>
        ) : (
          <form onSubmit={emailSubmit} className="space-y-3">
            {mode === "signup" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" className="w-full rounded-xl px-4 py-3.5 outline-none" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }} />}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" className="w-full rounded-xl px-4 py-3.5 outline-none" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full rounded-xl px-4 py-3.5 outline-none" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }} />
            <PrimaryButton disabled={unavailable || busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</PrimaryButton>
          </form>
        )}

        {method === "email" && <div className="flex justify-between mt-4 text-xs"><button onClick={resetPassword} disabled={unavailable || busy} style={{ color: COLORS.accentText }}>Forgot password?</button><button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }} style={{ color: COLORS.textSecondary }}>{mode === "login" ? "Create account" : "Back to login"}</button></div>}
        {error && <p className="text-xs leading-relaxed mt-4" style={{ color: "#D99A8A" }}>{error}</p>}
        {notice && <p className="text-xs leading-relaxed mt-4" style={{ color: COLORS.accentText }}>{notice}</p>}

        <div className="mt-8 pt-5" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <p className="text-center text-xs mb-3" style={{ color: COLORS.textFaint }}>Account is optional. You can use NULLITY without signing in.</p>
          <GhostButton onClick={onContinueGuest}><span className="flex items-center justify-center gap-2"><User size={15}/> Continue without account</span></GhostButton>
        </div>
      </div>
    </div>
  );
}

const SCREENING_FEATURES = [
  ["low_mood", "Low mood"],
  ["loss_of_interest", "Loss of interest or enjoyment"],
  ["sleep_change", "Sleep changes"],
  ["energy_change", "Low energy"],
  ["appetite_change", "Appetite changes"],
  ["self_worth", "Feeling bad about yourself"],
  ["concentration", "Difficulty concentrating"],
  ["movement_change", "Feeling unusually slowed down or restless"],
  ["hopelessness", "Feeling hopeless"],
];

function ScreeningScreen({ onBack }) {
  const [scores, setScores] = useState(Array(9).fill(0));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = scores.reduce((a, b) => a + b, 0);
  const labels = ["Never", "Sometimes", "Often", "Nearly always"];

  async function runModel() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/screening/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scores }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Model unavailable.");
      setResult(body);
    } catch (e) { setError(e.message || "Could not run the model."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col h-full px-6 overflow-y-auto">
      <div className="pt-6"><BackRow onBack={onBack} label="Back" /></div>
      <div className="max-w-md mx-auto w-full pb-12">
        <p className="text-xs uppercase tracking-[0.18em]" style={{ color: COLORS.accentText }}>Experimental ML</p>
        <p className="mt-2" style={{ fontFamily: "var(--font-display)", fontSize: 27, color: COLORS.textPrimary }}>Wellbeing signal</p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
          Rate each area based on your recent experience. The model returns an elevated symptom-risk signal — it does not diagnose depression.
        </p>

        <div className="mt-8 space-y-6">
          {SCREENING_FEATURES.map(([key, question], i) => (
            <div key={key}>
              <div className="flex justify-between gap-4 mb-2">
                <p className="text-sm" style={{ color: COLORS.textPrimary }}>{i + 1}. {question}</p>
                <span className="text-xs" style={{ color: COLORS.accentText }}>{scores[i]}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {labels.map((label, value) => (
                  <button key={value} onClick={() => setScores((s) => s.map((x, idx) => idx === i ? value : x))} className="rounded-lg py-2 text-[11px]" style={{ border: `1px solid ${scores[i] === value ? COLORS.accent : COLORS.border}`, background: scores[i] === value ? COLORS.accentDim : "transparent", color: scores[i] === value ? COLORS.accentText : COLORS.textFaint }}>{label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl p-4" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <div className="flex justify-between text-sm"><span style={{ color: COLORS.textSecondary }}>Current symptom score</span><span style={{ color: COLORS.textPrimary }}>{total}/27</span></div>
        </div>

        <div className="mt-4"><PrimaryButton onClick={runModel} disabled={busy}>{busy ? "Running model…" : "Run ML screening"}</PrimaryButton></div>
        {error && <p className="text-xs mt-3" style={{ color: "#D99A8A" }}>{error}</p>}

        {result && (
          <div className="mt-6 rounded-2xl p-5" style={{ border: `1px solid ${result.elevatedRiskSignal ? COLORS.accent : COLORS.borderStrong}`, background: COLORS.surface }}>
            <p className="text-xs uppercase tracking-[0.15em]" style={{ color: COLORS.textFaint }}>Model output</p>
            <p className="mt-2" style={{ fontFamily: "var(--font-display)", fontSize: 24, color: COLORS.textPrimary }}>{result.riskPercent}% signal</p>
            <p className="mt-1 text-sm" style={{ color: COLORS.textSecondary }}>{result.elevatedRiskSignal ? "Elevated symptom-risk signal" : "No elevated symptom-risk signal"}</p>
            <p className="mt-4 text-xs leading-relaxed" style={{ color: COLORS.textFaint }}>{result.disclaimer}</p>
            {result.elevatedRiskSignal && <p className="mt-3 text-xs leading-relaxed" style={{ color: COLORS.textSecondary }}>If these experiences are persistent or affecting daily life, consider speaking with a qualified mental-health professional.</p>}
          </div>
        )}

        <div className="mt-8"><Disclaimer compact /></div>
      </div>
    </div>
  );
}

function LandingScreen({ onStartVoice, onStartText, onScreening, user, onLogout, onAuth }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  return (
    <div className="flex flex-col justify-between h-full">
      <div />
      <div className="text-center px-6">
        <h1 className="tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 400, color: COLORS.textPrimary }}>
          {greeting}
        </h1>
        <p className="mt-2" style={{ fontFamily: "var(--font-display)", fontSize: 22, color: COLORS.textSecondary, fontWeight: 400 }}>
          How was your day?
        </p>

        <div className="mt-14 max-w-xs mx-auto space-y-3">
          <PrimaryButton onClick={onStartVoice}>
            <span className="flex items-center justify-center gap-2"><Mic size={16} /> Start talking</span>
          </PrimaryButton>
          <GhostButton onClick={onStartText}>
            <span className="flex items-center justify-center gap-2"><Keyboard size={16} /> I'd rather type</span>
          </GhostButton>
        </div>

        <p className="mt-8 text-sm max-w-xs mx-auto" style={{ color: COLORS.textFaint }}>
          Your thoughts don't need to be organized. Just start somewhere.
        </p>
      </div>
      <div className="px-6 pb-6">
        <div className="max-w-xs mx-auto mb-4 rounded-xl p-3 text-left" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5"><ShieldCheck size={15} color={COLORS.accentText}/></div>
            <div className="flex-1">
              <p className="text-xs" style={{ color: COLORS.textPrimary }}>{user?.isGuest ? "Want to keep your journey across devices?" : `Signed in as ${user?.name || user?.email || "you"}.`}</p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: COLORS.textFaint }}>{user?.isGuest ? "Sign in is optional. Your current device-only mode will keep working." : "Your NULLITY history is scoped to your account on this browser."}</p>
              {user?.isGuest ? <button onClick={onAuth} className="mt-2 text-xs" style={{ color: COLORS.accentText }}>Sign in / create account →</button> : <button onClick={onLogout} className="mt-2 text-xs flex items-center gap-1" style={{ color: COLORS.textFaint }}><LogOut size={12}/> Sign out</button>}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center mb-4 max-w-xs mx-auto">
          <button onClick={onScreening} className="text-xs" style={{ color: COLORS.accentText }}>Try ML screening</button>
        </div>
        <div className="text-center"><Disclaimer compact /></div>
      </div>
    </div>
  );
}

function CheckInScreen({ onBack, onProcessed, speechSupported }) {
  const [mode, setMode] = useState(speechSupported ? "voice" : "text");
  const [isListening, setIsListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [typedText, setTypedText] = useState("");
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    recognitionRef.current?.stop?.();
  }, []);

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = () => { clearInterval(timerRef.current); setIsListening(false); };
    rec.onend = () => { clearInterval(timerRef.current); setIsListening(false); };
    recognitionRef.current = rec;
    clearInterval(timerRef.current);
    setTranscript("");
    setSeconds(0);
    rec.start();
    setIsListening(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopListening() {
    recognitionRef.current?.stop?.();
    clearInterval(timerRef.current);
    setIsListening(false);
  }

  async function handleSubmit(text) {
    if (!text || !text.trim() || busy) return;
    setBusy(true);
    await onProcessed(text.trim());
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex flex-col h-full px-6">
      <div className="pt-6">
        <BackRow onBack={onBack} />
      </div>

      {mode === "voice" ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
            {isListening && (
              <span className="absolute rounded-full" style={{
                width: 140, height: 140, border: `1px solid ${COLORS.accent}`,
                animation: "nullityPulse 2.2s ease-out infinite", opacity: 0.5,
              }} />
            )}
            <button
              onClick={isListening ? stopListening : startListening}
              className="rounded-full flex items-center justify-center transition-all duration-300"
              style={{
                width: 96, height: 96,
                background: isListening ? COLORS.accentDim : COLORS.surface,
                border: `1px solid ${isListening ? COLORS.accent : COLORS.borderStrong}`,
              }}
            >
              {isListening ? <Square size={22} color={COLORS.accentText} /> : <Mic size={26} color={COLORS.textPrimary} />}
            </button>
          </div>

          <p className="mt-8 text-lg" style={{ fontFamily: "var(--font-display)", color: COLORS.textPrimary }}>
            {isListening ? "Listening" : "Tell me about your day"}
          </p>
          {isListening && <p className="mt-1 text-sm" style={{ color: COLORS.textFaint }}>{mm}:{ss}</p>}

          {transcript && (
            <p className="mt-6 max-w-sm text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
              {transcript}
            </p>
          )}

          <div className="mt-10 max-w-xs w-full space-y-3">
            {!isListening && transcript && (
              <PrimaryButton onClick={() => handleSubmit(transcript)} disabled={busy}>
                {busy ? "Thinking…" : "Continue"}
              </PrimaryButton>
            )}
            <GhostButton onClick={() => setMode("text")}>
              <span className="flex items-center justify-center gap-2"><Keyboard size={15} /> I'd rather type</span>
            </GhostButton>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
          {!speechSupported && (
            <p className="text-sm mb-4 text-center" style={{ color: COLORS.textFaint }}>
              Voice input isn't available here. You can type instead.
            </p>
          )}
          <p className="text-lg mb-4" style={{ fontFamily: "var(--font-display)", color: COLORS.textPrimary }}>
            Tell me about your day
          </p>
          <textarea
            autoFocus
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Start anywhere…"
            rows={6}
            className="w-full rounded-xl p-4 text-[15px] resize-none outline-none"
            style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
          />
          <div className="mt-4 space-y-3">
            <PrimaryButton onClick={() => handleSubmit(typedText)} disabled={!typedText.trim() || busy}>
              {busy ? "Thinking…" : "Continue"}
            </PrimaryButton>
            {speechSupported && (
              <GhostButton onClick={() => setMode("voice")}>
                <span className="flex items-center justify-center gap-2"><Mic size={15} /> I'd rather talk</span>
              </GhostButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CrisisScreen({ onDone }) {
  return (
    <div className="flex flex-col justify-center h-full px-6 text-center max-w-sm mx-auto">
      <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: COLORS.textPrimary }}>
        It sounds like you might be going through something serious.
      </p>
      <p className="mt-4 text-sm leading-relaxed" style={{ color: COLORS.textSecondary }}>
        NULLITY isn't equipped to help with this. Please reach out to a real person — in the US you can call
        or text 988 anytime, or if you're elsewhere, please look up your local crisis line or emergency
        number. You deserve support beyond an app.
      </p>
      <div className="mt-10">
        <GhostButton onClick={onDone}>Back to NULLITY</GhostButton>
      </div>
    </div>
  );
}

function PlanScreen({ checkIn, plan, completedIds, onStartActivity, onFinish, onBack }) {
  return (
    <div className="flex flex-col h-full px-6">
      <div className="pt-6"><BackRow onBack={onBack} /></div>
      <div className="max-w-md mx-auto w-full flex-1">
        <p style={{ fontFamily: "var(--font-display)", fontSize: 24, color: COLORS.textPrimary, lineHeight: 1.3 }}>
          {checkIn.summary}
        </p>
        <p className="mt-2 text-sm" style={{ color: COLORS.textSecondary }}>
          Let's create a little space.
        </p>

        <div className="mt-10 space-y-3">
          {plan.map((activity, i) => {
            const done = completedIds.includes(activity.id);
            return (
              <button
                key={activity.id}
                onClick={() => !done && onStartActivity(activity)}
                disabled={done}
                className="w-full text-left rounded-xl p-4 transition-colors duration-200"
                style={{ border: `1px solid ${done ? COLORS.border : COLORS.borderStrong}`, background: done ? "transparent" : COLORS.surface }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm w-4" style={{ color: COLORS.textFaint }}>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <p style={{ color: done ? COLORS.textFaint : COLORS.textPrimary, fontSize: 15, textDecoration: done ? "line-through" : "none" }}>
                        {activity.title}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: COLORS.textFaint }}>
                        {activity.minutesLabel} · {activityBlurb(activity, checkIn)}
                      </p>
                    </div>
                  </div>
                  {done && <Check size={16} color={COLORS.accent} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="max-w-md mx-auto w-full pb-8 pt-6">
        <PrimaryButton onClick={onFinish}>
          {completedIds.length > 0 ? "Go to your journey" : "Finish for today"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function BreathingActivity({ activity, onComplete }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function toggle() {
    if (running) {
      clearInterval(intervalRef.current);
      setRunning(false);
      return;
    }
    setRunning(true);
    intervalRef.current = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= activity.duration) {
          clearInterval(intervalRef.current);
          setRunning(false);
          onComplete();
          return activity.duration;
        }
        return e + 1;
      });
    }, 1000);
  }

  const cyclePos = elapsed % 12;
  const phase = cyclePos < 4 ? "Inhale" : cyclePos < 6 ? "Hold" : "Exhale";
  const phaseSeconds = cyclePos < 4 ? 4 - cyclePos : cyclePos < 6 ? 6 - cyclePos : 12 - cyclePos;
  const scale = phase === "Inhale" ? 1 + (cyclePos / 4) * 0.35 : phase === "Hold" ? 1.35 : 1.35 - ((cyclePos - 6) / 6) * 0.35;
  const remaining = activity.duration - elapsed;

  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center">
      <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
        <div
          className="rounded-full"
          style={{
            width: 130, height: 130,
            background: COLORS.accentDim,
            border: `1px solid ${COLORS.accent}`,
            transform: `scale(${running ? scale : 1})`,
            transition: "transform 1s linear",
          }}
        />
      </div>
      <p className="mt-6 text-lg" style={{ fontFamily: "var(--font-display)", color: COLORS.textPrimary }}>
        {running ? phase : "Ready when you are"}
      </p>
      {running && <p className="text-sm mt-1" style={{ color: COLORS.textFaint }}>{phaseSeconds}s</p>}
      <p className="mt-4 text-xs" style={{ color: COLORS.textFaint }}>
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} remaining
      </p>
      <div className="mt-10 max-w-xs w-full">
        <PrimaryButton onClick={toggle}>
          <span className="flex items-center justify-center gap-2">
            {running ? <Pause size={16} /> : <Play size={16} />} {running ? "Pause" : elapsed > 0 ? "Resume" : "Begin"}
          </span>
        </PrimaryButton>
      </div>
    </div>
  );
}

function ReflectionActivity({ onComplete }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col flex-1 max-w-md mx-auto w-full">
      <p style={{ fontFamily: "var(--font-display)", fontSize: 20, color: COLORS.textPrimary }}>
        What is taking up the most space in your mind right now?
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Write freely — this stays on your device."
        className="w-full mt-5 rounded-xl p-4 text-[15px] resize-none outline-none flex-1"
        style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
      />
      <div className="mt-5">
        <PrimaryButton onClick={() => onComplete(text.trim())} disabled={!text.trim()}>
          Done
        </PrimaryButton>
      </div>
    </div>
  );
}

function FocusActivity({ activity, onComplete }) {
  const [task, setTask] = useState("");
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(activity.duration);
  const intervalRef = useRef(null);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function toggle() {
    if (running) {
      clearInterval(intervalRef.current);
      setRunning(false);
      return;
    }
    setRunning(true);
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          onComplete(task);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  if (!started) {
    return (
      <div className="flex flex-col flex-1 justify-center max-w-md mx-auto w-full text-center">
        <p style={{ fontFamily: "var(--font-display)", fontSize: 20, color: COLORS.textPrimary }}>Choose one thing.</p>
        <input
          autoFocus
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="One small, doable task"
          className="w-full mt-5 rounded-xl p-4 text-[15px] outline-none"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary }}
        />
        <div className="mt-5">
          <PrimaryButton onClick={() => setStarted(true)} disabled={!task.trim()}>Start 10 minutes</PrimaryButton>
        </div>
      </div>
    );
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center">
      <p className="text-sm mb-3" style={{ color: COLORS.textSecondary }}>{task}</p>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 56, color: COLORS.textPrimary, fontWeight: 300 }}>
        {mm}:{ss}
      </p>
      <div className="mt-8 max-w-xs w-full">
        <PrimaryButton onClick={toggle}>
          <span className="flex items-center justify-center gap-2">
            {running ? <Pause size={16} /> : <Play size={16} />} {running ? "Pause" : "Resume"}
          </span>
        </PrimaryButton>
      </div>
    </div>
  );
}

function ActivityScreen({ activity, onBack, onSessionComplete }) {
  const [stage, setStage] = useState("before"); // before -> doing -> after
  const [moodBefore, setMoodBefore] = useState(null);
  const [reflectionText, setReflectionText] = useState(undefined);

  function handleActivityDone(text) {
    if (typeof text === "string") setReflectionText(text);
    setStage("after");
  }

  return (
    <div className="flex flex-col h-full px-6">
      <div className="pt-6"><BackRow onBack={onBack} label="Back to plan" /></div>

      {stage === "before" && (
        <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
          <p style={{ fontFamily: "var(--font-display)", fontSize: 20, color: COLORS.textPrimary, textAlign: "center" }}>
            How do you feel right now?
          </p>
          <div className="mt-6">
            <RatingScale value={moodBefore} onChange={setMoodBefore} />
          </div>
          <div className="mt-8">
            <PrimaryButton onClick={() => setStage("doing")} disabled={!moodBefore}>Continue</PrimaryButton>
          </div>
        </div>
      )}

      {stage === "doing" && (
        <>
          {activity.type === "breathing" && <BreathingActivity activity={activity} onComplete={() => handleActivityDone()} />}
          {activity.type === "reflection" && <ReflectionActivity onComplete={handleActivityDone} />}
          {activity.type === "focus" && <FocusActivity activity={activity} onComplete={() => handleActivityDone()} />}
        </>
      )}

      {stage === "after" && (
        <AfterRating
          moodBefore={moodBefore}
          onSubmit={(moodAfter) => onSessionComplete({ activityId: activity.id, moodBefore, moodAfter, reflectionText })}
        />
      )}
    </div>
  );
}

function AfterRating({ moodBefore, onSubmit }) {
  const [moodAfter, setMoodAfter] = useState(null);
  return (
    <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
      <p style={{ fontFamily: "var(--font-display)", fontSize: 20, color: COLORS.textPrimary, textAlign: "center" }}>And now?</p>
      <div className="mt-6">
        <RatingScale value={moodAfter} onChange={setMoodAfter} />
      </div>
      <div className="mt-8">
        <PrimaryButton onClick={() => onSubmit(moodAfter)} disabled={!moodAfter}>
          Complete
        </PrimaryButton>
      </div>
      {moodBefore && moodAfter && (
        <p className="mt-4 text-center text-sm" style={{ color: COLORS.textFaint }}>
          You felt {moodBefore} → {moodAfter} after this session.
        </p>
      )}
    </div>
  );
}

function XPToast({ show }) {
  if (!show) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm"
      style={{
        top: 24, background: COLORS.surface, border: `1px solid ${COLORS.accent}`, color: COLORS.accentText,
        animation: "nullityRise 2.4s ease forwards", zIndex: 50,
      }}
    >
      +30 XP
    </div>
  );
}

function JourneyScreen({ data, onBack, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const recentSessions = [...data.sessions].reverse().slice(0, 8);

  const trendPoints = data.sessions.slice(-14).map((s) => ({ value: s.moodAfter }));

  const themeCounts = {};
  data.checkIns.forEach((c) => c.themes.forEach((t) => { themeCounts[t] = (themeCounts[t] || 0) + 1; }));
  const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  function activityTitle(id) {
    return ACTIVITY_LIBRARY.find((a) => a.id === id)?.title || id;
  }

  return (
    <div className="flex flex-col h-full px-6 overflow-y-auto">
      <div className="pt-6"><BackRow onBack={onBack} label="Back" /></div>
      <div className="max-w-md mx-auto w-full pb-10">
        <p style={{ fontFamily: "var(--font-display)", fontSize: 26, color: COLORS.textPrimary }}>Your space</p>

        <div className="mt-8">
          <p className="text-sm mb-2" style={{ color: COLORS.textSecondary }}>Mood trend</p>
          <Sparkline points={trendPoints} />
        </div>

        <div className="mt-8 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl p-4" style={{ border: `1px solid ${COLORS.border}` }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: COLORS.textPrimary }}>{data.sessions.length}</p>
            <p className="text-xs mt-1" style={{ color: COLORS.textFaint }}>activities</p>
          </div>
          <div className="rounded-xl p-4" style={{ border: `1px solid ${COLORS.border}` }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: COLORS.textPrimary }}>{data.checkIns.length}</p>
            <p className="text-xs mt-1" style={{ color: COLORS.textFaint }}>check-ins</p>
          </div>
          <div className="rounded-xl p-4" style={{ border: `1px solid ${COLORS.border}` }}>
            <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: COLORS.textPrimary }}>{data.streak}</p>
            <p className="text-xs mt-1" style={{ color: COLORS.textFaint }}>day streak</p>
          </div>
        </div>

        {topThemes.length > 0 && (
          <div className="mt-8">
            <p className="text-sm mb-3" style={{ color: COLORS.textSecondary }}>Common themes</p>
            <div className="flex flex-wrap gap-2">
              {topThemes.map(([theme]) => (
                <span key={theme} className="text-xs rounded-full px-3 py-1.5" style={{ border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}>
                  {theme.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <p className="text-sm mb-3" style={{ color: COLORS.textSecondary }}>Recent sessions</p>
          {recentSessions.length === 0 && (
            <p className="text-sm" style={{ color: COLORS.textFaint }}>Nothing here yet — your first session will show up after you complete an activity.</p>
          )}
          <div className="space-y-2">
            {recentSessions.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl p-3" style={{ border: `1px solid ${COLORS.border}` }}>
                <div>
                  <p className="text-sm" style={{ color: COLORS.textPrimary }}>{activityTitle(s.activityId)}</p>
                  <p className="text-xs mt-0.5" style={{ color: COLORS.textFaint }}>
                    {new Date(s.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <p className="text-xs" style={{ color: COLORS.textSecondary }}>{s.moodBefore} → {s.moodAfter}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10">
          {confirmReset ? (
            <div className="flex gap-3">
              <GhostButton onClick={() => setConfirmReset(false)}>Cancel</GhostButton>
              <PrimaryButton onClick={onReset}>Confirm reset</PrimaryButton>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="flex items-center gap-2 text-xs mx-auto" style={{ color: COLORS.textFaint }}>
              <RotateCcw size={12} /> Reset my data
            </button>
          )}
        </div>

        <div className="mt-8">
          <Disclaimer compact />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- App ------------------------------------ */

export default function NullityApp() {
  const [view, setView] = useState("landing"); // landing | checkin | plan | activity | journey | crisis | screening
  const [currentUser, setCurrentUser] = useState(null);
  const [data, setData] = useState(EMPTY_DATA);
  const [dataReady, setDataReady] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [currentCheckIn, setCurrentCheckIn] = useState(null);
  const [currentPlan, setCurrentPlan] = useState([]);
  const [completedIds, setCompletedIds] = useState([]);
  const [activeActivity, setActiveActivity] = useState(null);
  const [showXP, setShowXP] = useState(false);

  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    if (!firebaseConfigured || !auth) {
      setCurrentUser({ id: GUEST_ID, name: "Guest", isGuest: true });
      loadData(GUEST_ID).then((d) => { setData(d); setDataReady(true); });
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const uid = user.uid;
        const guestData = await loadData(GUEST_ID);
        const accountData = await loadData(uid);
        const hasGuestData = guestData.checkIns.length || guestData.sessions.length || guestData.xp;
        const merged = hasGuestData && !accountData.checkIns.length && !accountData.sessions.length ? guestData : accountData;
        if (hasGuestData && merged === guestData) await saveData(uid, guestData);
        setCurrentUser({ id: uid, name: user.displayName || user.email || user.phoneNumber || "User", email: user.email || null, phone: user.phoneNumber || null, photoURL: user.photoURL || null, isGuest: false });
        setData(merged);
      } else {
        setCurrentUser({ id: GUEST_ID, name: "Guest", isGuest: true });
        setData(await loadData(GUEST_ID));
      }
      setDataReady(true);
    });
    return unsubscribe;
  }, []);

  const persist = useCallback((next) => {
    setData(next);
    saveData(currentUser?.id || GUEST_ID, next);
  }, [currentUser]);

  function handleAuthenticated(user, preferredName) {
    setShowAuth(false);
    setCurrentUser({ id: user.uid, name: preferredName || user.displayName || user.email || user.phoneNumber || "User", email: user.email || null, phone: user.phoneNumber || null, photoURL: user.photoURL || null, isGuest: false });
    loadData(user.uid).then((d) => { setData(d); setDataReady(true); });
  }

  async function logout() {
    if (firebaseConfigured && auth) await signOut(auth);
    setShowAuth(false);
    setCurrentUser({ id: GUEST_ID, name: "Guest", isGuest: true });
    loadData(GUEST_ID).then((d) => setData(d));
    setView("landing");
  }

  async function handleCheckInProcessed(rawText) {
    if (containsCrisisLanguage(rawText)) {
      setView("crisis");
      return;
    }
    const classification = await classifyCheckIn(rawText);
    const checkIn = { id: `ci_${Date.now()}`, timestamp: new Date().toISOString(), rawText, ...classification };
    const withStreak = bumpStreak(data);
    const next = { ...withStreak, checkIns: [...withStreak.checkIns, checkIn] };
    persist(next);
    setCurrentCheckIn(checkIn);
    setCurrentPlan(selectPlan(checkIn));
    setCompletedIds([]);
    setView("plan");
  }

  function handleStartActivity(activity) {
    setActiveActivity(activity);
    setView("activity");
  }

  function handleSessionComplete({ activityId, moodBefore, moodAfter, reflectionText }) {
    const session = {
      id: `s_${Date.now()}`,
      checkInId: currentCheckIn.id,
      activityId,
      moodBefore,
      moodAfter,
      completedAt: new Date().toISOString(),
      ...(reflectionText !== undefined ? { reflectionText } : {}),
    };
    const next = { ...data, xp: data.xp + 30, sessions: [...data.sessions, session] };
    persist(next);
    setCompletedIds((ids) => [...ids, activityId]);
    setShowXP(true);
    setTimeout(() => setShowXP(false), 2400);
    setView("plan");
  }

  function resetAll() {
    persist({ ...EMPTY_DATA });
    setView("landing");
  }

  if (!currentUser || !dataReady) {
    if (showAuth && firebaseConfigured) {
      return (
        <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: "var(--font-body)" }}>
          <AuthScreen onAuthenticated={handleAuthenticated} onContinueGuest={() => setShowAuth(false)} />
        </div>
      );
    }
    if (!currentUser) return null;
  }

  if (showAuth && firebaseConfigured) {
    return (
      <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: "var(--font-body)" }}>
        <AuthScreen onAuthenticated={handleAuthenticated} onContinueGuest={() => setShowAuth(false)} />
      </div>
    );
  }

  if (!dataReady) {
    return (
      <div style={{ background: COLORS.bg, height: "100%" }} className="flex items-center justify-center">
        <p className="text-sm" style={{ color: COLORS.textFaint, fontFamily: "var(--font-body)" }}>Loading your space…</p>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, height: "100%", minHeight: 640, fontFamily: "var(--font-body)" }} className="relative overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Inter:wght@400;500;600&display=swap');
        :root { --font-display: 'Fraunces', serif; --font-body: 'Inter', sans-serif; }
        * { box-sizing: border-box; }
        textarea::placeholder, input::placeholder { color: ${COLORS.textFaint}; }
        button { cursor: pointer; font-family: var(--font-body); }
        @keyframes nullityPulse {
          0% { transform: scale(0.9); opacity: 0.6; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes nullityRise {
          0% { opacity: 0; transform: translate(-50%, -8px); }
          15% { opacity: 1; transform: translate(-50%, 0); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -8px); }
        }
        .nullity-fade { animation: nullityFade 380ms ease; }
        @keyframes nullityFade { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <XPToast show={showXP} />

      <div key={view} className="nullity-fade" style={{ height: "100%" }}>
        {view === "landing" && (
          <LandingScreen
            onStartVoice={() => setView("checkin")}
            onStartText={() => setView("checkin")}
            onScreening={() => setView("screening")}
            user={currentUser}
            onLogout={logout}
            onAuth={() => setShowAuth(true)}
          />
        )}
        {view === "checkin" && (
          <CheckInScreen
            onBack={() => setView("landing")}
            onProcessed={handleCheckInProcessed}
            speechSupported={speechSupported}
          />
        )}
        {view === "screening" && <ScreeningScreen onBack={() => setView("landing")} />}
        {view === "crisis" && <CrisisScreen onDone={() => setView("landing")} />}
        {view === "plan" && currentCheckIn && (
          <PlanScreen
            checkIn={currentCheckIn}
            plan={currentPlan}
            completedIds={completedIds}
            onStartActivity={handleStartActivity}
            onFinish={() => setView("journey")}
            onBack={() => setView("landing")}
          />
        )}
        {view === "activity" && activeActivity && (
          <ActivityScreen
            activity={activeActivity}
            onBack={() => setView("plan")}
            onSessionComplete={handleSessionComplete}
          />
        )}
        {view === "journey" && (
          <JourneyScreen data={data} onBack={() => setView("landing")} onReset={resetAll} />
        )}
      </div>
    </div>
  );
}