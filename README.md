# NULLITY

**Make space for what matters.**

NULLITY is a voice-first wellbeing/reflection web app. It turns an unstructured day check-in into a small, deterministic routine while using Gemini only for interpretation/structuring.

## What's new in v1.2

- **Optional authentication:** users can continue as a guest and are never forced to create an account.
- **Google Sign-In** through Firebase Authentication.
- **Phone number OTP** sign-in through Firebase Authentication.
- **Email + password** signup/login.
- **Password reset email** flow.
- **Email verification** after email/password signup.
- Account data is scoped by Firebase UID in the browser.
- Existing guest history is migrated to the account on first sign-in when the account has no history yet.
- Authentication UI is intentionally presented as a request: “Save your journey across devices — if you want to.”

> **Security note:** NULLITY never emails or stores a user's password in plain text. Password-reset emails contain a secure reset action instead.

## Authentication setup

The code uses Firebase Authentication. Firebase supports Google sign-in, phone-number SMS authentication, email/password accounts, verification emails, and password reset emails. See the official Firebase Authentication documentation for provider setup.

1. Create a Firebase project.
2. Add a **Web App** in the Firebase console.
3. Go to **Authentication → Sign-in method**.
4. Enable:
   - Google
   - Phone
   - Email/Password
5. Add your local/deployed domain to Firebase Authentication's authorized domains.
6. Copy the Firebase Web App configuration into `.env`.

Create `.env` from `.env.example`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
# GEMINI_MODEL=gemini-2.5-flash-lite

VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

For phone OTP, Firebase uses a reCAPTCHA verifier before sending the SMS. Test phone numbers can be configured in Firebase Authentication during development so you do not repeatedly consume real SMS quotas.

## Run locally

```bash
npm install
```

Start:

```bash
npm run dev
```

Open `http://localhost:5173`.

Production build:

```bash
npm run build
npm start
```

## Guest mode

Authentication is **not mandatory**. If Firebase is not configured, NULLITY still works in guest/device-only mode. If Firebase is configured, the landing page still lets the user continue without an account.

The user is invited to sign in mainly to preserve their journey across devices.

## ML screening

The included `data/demo_screening.csv` is **synthetic demonstration data**. It exists so the full ML pipeline can be run locally and should not be represented as clinical evidence.

Retrain:

```bash
npm run train:screening
```

The script trains a Logistic Regression model, prints holdout metrics, and writes `ml/screening_model.json`.

Before using a model for any real health purpose, replace the demo dataset with a properly licensed, ethically collected and clinically validated dataset, perform appropriate external validation, calibration, subgroup/fairness analysis, and clinical review.

## Architecture

```text
React/Vite UI
   |
   +--> Firebase Authentication
   |       +--> Google
   |       +--> Phone OTP
   |       +--> Email/password
   |       +--> Password reset
   |
   +--> /api/classify ----------> Gemini
   |
   +--> /api/screening/predict -> Logistic Regression artifact
   |
   +--> localStorage ----------> guest/account-scoped history
```

## Important health/safety note

NULLITY is a wellness/reflection product, not a medical or mental-health treatment service. The ML feature must not be presented as diagnosing depression. Screening tools can indicate symptom severity/risk but do not establish a diagnosis.
