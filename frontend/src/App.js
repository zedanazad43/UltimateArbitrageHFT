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
      onAuthed={() => {
        setToken(getToken());
        setAuthed(true);
      }}
    />
  );
}
