import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card surface">
        <p className="brand">CertiBuy</p>
        {children}
      </div>
    </main>
  );
}
