import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Plus, Trash2, ShieldCheck, X, Check, KeyRound } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const ROLES = ["admin", "viewer"];
const empty = { email: "", password: "", name: "", role: "viewer" };

export default function Users() {
  const { user, logout } = useAuth();
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [pw, setPw] = useState({ new: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setItems(data);
    } catch (err) {
      console.error("users load failed", err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/users", form);
      setForm(empty);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create user");
    }
  };

  const setRole = async (u, role) => {
    if (u.role === role) return;
    try {
      await api.patch(`/users/${u.id}`, { role });
      await load();
    } catch (err) {
      console.error("role update failed", err);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || "Delete failed");
    }
  };

  const changeMyPassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.new.length < 8) {
      setPwMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    if (pw.new !== pw.confirm) {
      setPwMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    setPwBusy(true);
    try {
      await api.patch(`/users/${user.id}`, { password: pw.new });
      setPwMsg({ ok: true, text: "Password updated. Signing you out — log back in with the new password." });
      setPw({ new: "", confirm: "" });
      setTimeout(() => { logout(); }, 1800);  // token was just revoked server-side
    } catch (err) {
      setPwMsg({ ok: false, text: err.response?.data?.detail || "Failed to update password" });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl" data-testid="users-page">
      {/* Change-my-password card — admin can rotate their own password without touching .env */}
      <Card testid="change-my-password-card">
        <CardHeader
          subtitle="[ Self-service ]"
          title="Change My Password"
          right={<Pill tone="accent"><KeyRound size={10} /> {user?.email}</Pill>}
        />
        <form onSubmit={changeMyPassword} className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end" data-testid="change-my-password-form">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">New password</div>
            <input
              type="password"
              value={pw.new}
              onChange={(e) => setPw({ ...pw, new: e.target.value })}
              minLength={8}
              required
              data-testid="cmp-new-input"
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">Confirm new password</div>
            <input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              minLength={8}
              required
              data-testid="cmp-confirm-input"
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pwBusy}
            data-testid="cmp-save-button"
            className="text-xs bg-primary text-black hover:bg-primary-hover disabled:opacity-40 px-4 py-2 rounded-sm flex items-center justify-center gap-1.5"
          >
            <ShieldCheck size={12} /> {pwBusy ? "saving..." : "Update Password"}
          </button>
          {pwMsg && (
            <div
              data-testid="cmp-status"
              className={`md:col-span-3 text-xs px-3 py-2 rounded-sm border flex items-center gap-1.5 ${
                pwMsg.ok ? "border-primary/50 text-primary bg-primary/5" : "border-destructive/50 text-destructive bg-destructive/5"
              }`}
            >
              {pwMsg.ok ? <Check size={12} /> : <X size={12} />} {pwMsg.text}
            </div>
          )}
          <div className="md:col-span-3 text-[11px] text-muted font-mono">
            After saving, all existing sessions for your account are revoked. You&apos;ll be signed out automatically.
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          subtitle="[ Identity ]"
          title="Team Members"
          right={
            <div className="flex items-center gap-2">
              <Pill tone="accent" testid="users-count">{items.length} users</Pill>
              <button
                onClick={() => {
                  setAdding((a) => !a);
                  setError("");
                  setForm(empty);
                }}
                data-testid="users-add-toggle"
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm border ${
                  adding ? "border-destructive/60 text-destructive" : "border-primary text-primary bg-primary/10"
                }`}
              >
                {adding ? <X size={12} /> : <Plus size={12} />}
                {adding ? "Cancel" : "Add User"}
              </button>
            </div>
          }
        />
        {adding && (
          <form onSubmit={create} className="p-4 border-b border-border/60 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="users-add-form">
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                data-testid="users-email-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="users-name-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Password (min 6)">
              <input
                type="password"
                value={form.password}
                minLength={6}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                data-testid="users-password-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Role">
              <div className="flex gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    data-testid={`users-role-${r}`}
                    onClick={() => setForm({ ...form, role: r })}
                    className={`text-xs uppercase tracking-wider px-3 py-2 rounded-sm border ${
                      form.role === r ? "border-primary text-primary bg-primary/10" : "border-border text-muted"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            {error && (
              <div className="md:col-span-2 border border-destructive/50 bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-sm" data-testid="users-error">
                {error}
              </div>
            )}
            <div className="md:col-span-2">
              <button
                type="submit"
                data-testid="users-save-button"
                className="text-xs bg-primary text-black hover:bg-primary-hover px-4 py-2 rounded-sm flex items-center gap-1.5"
              >
                <ShieldCheck size={12} /> Create User
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-border/60">
          {items.map((u) => (
            <div key={u.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-6 gap-3 items-center" data-testid={`user-row-${u.email}`}>
              <div className="md:col-span-2">
                <div className="text-sm font-medium">{u.name || "—"}</div>
                <div className="text-[11px] text-muted font-mono">{u.email}</div>
              </div>
              <div className="md:col-span-2 flex gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(u, r)}
                    data-testid={`user-set-role-${u.email}-${r}`}
                    disabled={u.email === user?.email}
                    className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-sm border disabled:opacity-40 disabled:cursor-not-allowed ${
                      u.role === r
                        ? r === "admin"
                          ? "border-primary text-primary bg-primary/10"
                          : "border-accent text-accent bg-accent/10"
                        : "border-border text-muted hover:text-white"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="md:col-span-1 text-[11px] text-muted font-mono">
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
              </div>
              <div className="md:col-span-1 flex justify-end">
                <button
                  onClick={() => remove(u)}
                  data-testid={`user-delete-${u.email}`}
                  disabled={u.email === user?.email}
                  className="text-xs px-2 py-1 rounded-sm border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}
