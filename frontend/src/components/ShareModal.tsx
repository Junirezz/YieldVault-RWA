import React, { useState } from "react";
import { Share2, Copy, Check, X, MessageCircle, Twitter, Facebook, Link as LinkIcon } from "../icons";
import Modal from "./Modal";
import { copyTextToClipboard } from "../lib/clipboard";
import { useToast } from "../context/ToastContext";
import { useTranslation } from "../i18n";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  referralLink: string;
  referralCode: string;
}

const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  referralLink,
  referralCode,
}) => {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const { t } = useTranslation();

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(referralLink);
      setCopied(true);
      toast.success({
        title: "Link copied",
        description: "Referral link has been copied to your clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error({
        title: "Copy failed",
        description: "Could not copy link to clipboard.",
      });
    }
  };

  const shareTargets = [
    {
      name: "Twitter",
      icon: Twitter,
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        `Join me on YieldVault and earn stable yields on real-world assets! Use my referral code: ${referralCode}\n\n${referralLink}`
      )}`,
      color: "#1DA1F2",
    },
    {
      name: "Facebook",
      icon: Facebook,
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`,
      color: "#4267B2",
    },
    {
      name: "Telegram",
      icon: MessageCircle,
      url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(
        `Join me on YieldVault and earn stable yields! Use my referral code: ${referralCode}`
      )}`,
      color: "#0088CC",
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share Your Referral Link"
      size="md"
    >
      <div className="flex flex-col gap-lg">
        <div className="text-center">
          <Share2 size={48} color="var(--accent-cyan)" className="mx-auto mb-sm" />
          <p className="text-body-sm" style={{ color: "var(--text-secondary)" }}>
            Share your unique referral link and earn rewards when others join and deposit!
          </p>
        </div>

        <div className="glass-panel" style={{ padding: "16px" }}>
          <div className="flex items-center gap-sm mb-sm">
            <span className="text-body-sm font-medium">Your Referral Code:</span>
            <code
              style={{
                background: "var(--bg-muted)",
                padding: "4px 8px",
                borderRadius: "4px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.9rem",
                color: "var(--accent-cyan)",
              }}
            >
              {referralCode}
            </code>
          </div>
          <div className="copy-field">
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
              }}
              title={referralLink}
            >
              {referralLink}
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleCopy}
              style={{ padding: "6px 12px" }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <h4 className="text-body-sm font-medium mb-sm">Share via:</h4>
          <div className="flex gap-sm flex-wrap">
            {shareTargets.map((target) => (
              <a
                key={target.name}
                href={target.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  borderColor: target.color,
                  color: target.color,
                }}
              >
                <target.icon size={16} />
                {target.name}
              </a>
            ))}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{
            padding: "12px",
            background: "rgba(0, 240, 255, 0.05)",
            border: "1px solid rgba(0, 240, 255, 0.2)",
          }}
        >
          <div className="flex items-start gap-sm">
            <div
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "var(--accent-cyan)",
                flexShrink: 0,
                marginTop: "2px",
              }}
            />
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              <strong>How it works:</strong> When someone uses your referral link to deposit, you'll earn 5% of their yield rewards. Track your referrals and earnings on the Portfolio page.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ShareModal;