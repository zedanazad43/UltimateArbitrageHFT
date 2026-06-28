import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { motion } from "framer-motion";

const AUTH_BG = "https://images.pexels.com/photos/30547584/pexels-photo-30547584.jpeg";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("admin@arbhft.io");
  const [password, setPassword] = useState("Admin@123");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(email, password);
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4"
      style={{
        backgroundImage: `linear-gradient(rgba(5,5,5,0.85),rgba(5,5,5,0.92)), url(${AUTH_BG})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      data-testid="login-screen"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-md backdrop-blur-xl bg-surface/80 border border-white/10 rounded-sm p-8"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="h-9 w-9 rounded-sm bg-primary/15 border border-primary/40 flex items-center justify-center">
            <span className="font-display font-bold text-primary text-lg">U</span>
          </div>
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">UltimateArbitrageHFT</div>
            <div className="text-xs text-muted">Control Center · v1.4.2</div>
          </div>
        </div>

        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted mb-1">[ Secure Access ]</div>
          <h1 className="font-display text-2xl tracking-tight">Sign in to continue</h1>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="login-email-input"
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2.5 text-sm focus:border-primary focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password-input"
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2.5 text-sm focus:border-primary focus:outline-none transition-colors font-mono"
            />
          </div>

          {error && (
            <div
              data-testid="login-error"
              className="border border-destructive/50 bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit-button"
            className="w-full bg-primary text-black hover:bg-primary-hover disabled:opacity-50 font-medium py-2.5 rounded-sm text-sm tracking-wide transition-colors"
          >
            {loading ? "[ CONNECTING... ]" : "Enter Control Center"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-border/60 text-[11px] text-muted font-mono">
          default · admin@arbhft.io / Admin@123
        </div>
      </motion.div>
    </div>
  );
}
