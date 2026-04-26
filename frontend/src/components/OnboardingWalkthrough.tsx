import React, { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

interface Step {
  title: string;
  copy: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to YieldVault!",
    copy: "Earn institutional yields backed by Real-World Assets.",
  },
  {
    title: "Connect Wallet",
    copy: "Connect your Freighter wallet using the 'Connect Wallet' button in the top right to get started.",
  },
  {
    title: "Input Amount",
    copy: "Enter the amount of USDC you'd like to deposit in the Vault Dashboard.",
  },
  {
    title: "Deposit & Earn",
    copy: "Approve the spend and click Deposit to start earning daily yield!",
  },
];

const LOCAL_STORAGE_KEY = "hasSeenWalkthrough";

const OnboardingWalkthrough: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const hasSeen = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!hasSeen) {
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    setIsVisible(false);
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        className="glass-panel"
        style={{
          backgroundColor: "var(--bg-card, #1a1a1a)",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "400px",
          width: "100%",
          position: "relative",
          border: "1px solid var(--border-glass, rgba(255, 255, 255, 0.1))",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        <button
          onClick={handleDismiss}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary, #a0a0a0)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Close walkthrough"
        >
          <X size={20} />
        </button>

        <div style={{ marginBottom: "24px", paddingTop: "8px" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              marginBottom: "12px",
              color: "var(--text-primary, #ffffff)",
            }}
          >
            {STEPS[currentStep].title}
          </h2>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: "1.5",
              color: "var(--text-secondary, #a0a0a0)",
            }}
          >
            {STEPS[currentStep].copy}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid var(--border-glass, rgba(255, 255, 255, 0.1))",
            paddingTop: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            {STEPS.map((_, index) => (
              <div
                key={index}
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor:
                    index === currentStep
                      ? "var(--accent-cyan, #00f0ff)"
                      : "rgba(255, 255, 255, 0.2)",
                  transition: "background-color 0.2s ease",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            {currentStep > 0 && (
              <button
                onClick={handlePrevious}
                className="btn btn-outline"
                style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="btn btn-primary"
              style={{
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: "var(--accent-cyan, #00f0ff)",
                color: "#000",
                border: "none",
                fontWeight: 600,
              }}
            >
              {currentStep === STEPS.length - 1 ? "Finish" : "Next"}
              {currentStep < STEPS.length - 1 && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingWalkthrough;
