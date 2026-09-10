"""Train the NULLITY demonstration screening model.

This is a SOFTWARE/ML demo pipeline, not a clinical model. Do not deploy it
for diagnosis or clinical decision-making. Replace the demo CSV with a
properly licensed, ethically collected and clinically validated dataset
before making any health claim.
"""
import json
import os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "demo_screening.csv")
OUT = os.path.join(os.path.dirname(__file__), "screening_model.json")
FEATURES = [
    "low_mood", "loss_of_interest", "sleep_change", "energy_change",
    "appetite_change", "self_worth", "concentration", "movement_change", "hopelessness"
]

def main():
    rows = np.genfromtxt(DATA, delimiter=",", names=True, dtype=float)
    X = np.column_stack([rows[f] for f in FEATURES])
    y = rows["label"].astype(int)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    model = LogisticRegression(max_iter=2000, class_weight="balanced")
    model.fit(X_train, y_train)
    pred = model.predict(X_test)
    print("Demo accuracy:", round(accuracy_score(y_test, pred), 3))
    print(classification_report(y_test, pred))

    artifact = {
        "name": "NULLITY Demo Symptom-Risk Logistic Regression",
        "version": 1,
        "features": FEATURES,
        "coefficients": model.coef_[0].round(8).tolist(),
        "intercept": float(model.intercept_[0]),
        "threshold": 0.5,
        "training_note": "Synthetic demonstration data only; not clinically valid."
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
    print("Wrote", OUT)

if __name__ == "__main__":
    main()
