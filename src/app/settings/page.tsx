import type { Metadata } from "next";
import { SettingsPanel } from "@/components/SettingsPanel";

export const metadata: Metadata = {
  title: "Settings | PulsePairs",
  description:
    "Manage your connected wallet, notification preferences, and Terms of Service acceptance state.",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto" style={{ maxWidth: 640 }}>
      <header className="pp-pagetop">
        <h1 className="pp-h1">Settings</h1>
        <p className="pp-caption">
          Manage your wallet, notifications, and legal acknowledgements.
          Settings are local to this browser — connecting on a different
          device starts fresh.
        </p>
      </header>
      <SettingsPanel />
    </div>
  );
}
