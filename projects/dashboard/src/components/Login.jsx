import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { motion } from "framer-motion";

export default function Login() {
  const { login, error } = useAuth();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(token);
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 grid-bg"
      style={{ background: "#050505" }}
      data-testid="login-screen"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-md bg-surface border border-border/60 rounded-sm p-8"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-sm bg-primary/15 border border-primary/40 flex items-center justify-center">
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
            <label className="block text-xs uppercase tracking-wider text-muted mb-2">Admin Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ADMIN_TOKEN"
              required
              autoFocus
              data-testid="login-token-input"
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

        <div className="mt-6 pt-5 border-t border-border/60 text-[11px] text-muted font-mono leading-relaxed">
          first-time access? check the <span className="text-white">ADMIN_TOKEN</span> your operator configured.
          <br />set it as the <span className="text-white">ADMIN_TOKEN</span> environment variable in the Worker.
        </div>
      </motion.div>
    </div>
  );
}
