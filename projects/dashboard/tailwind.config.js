/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050505",
        surface: "#0A0A0B",
        elevated: "#121214",
        border: "#222222",
        primary: "#00E676",
        "primary-hover": "#00C853",
        destructive: "#FF3B30",
        "destructive-hover": "#D32F2F",
        muted: "#888888",
        accent: "#007AFF",
      },
      fontFamily: {
        display: ['"Unbounded"', "system-ui", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        sm: "2px",
      },
      keyframes: {
        flash: {
          "0%": { backgroundColor: "rgba(0,230,118,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        pulseDot: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.35 },
        },
      },
      animation: {
        flash: "flash 600ms ease-out",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
