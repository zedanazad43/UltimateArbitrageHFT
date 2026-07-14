import React, { useState } from "react";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import { getToken, setToken } from "./lib/api";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());

  return authed ? (
    <Dashboard onLogout={() => setAuthed(false)} />
  ) : (
    <Login
      onAuthed={(t) => {
        if (t) setToken(t);
        setAuthed(true);
      }}
    />
  );
}
