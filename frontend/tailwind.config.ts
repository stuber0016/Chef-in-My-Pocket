import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orb: {
          primary: "#6366f1",
          secondary: "#8b5cf6",
          glow: "rgba(99, 102, 241, 0.3)",
        },
        cart: {
          bg: "#f8fafc",
          border: "#e2e8f0",
          accent: "#10b981",
        }
      },
      animation: {
        "orb-pulse": "orb-pulse 2s ease-in-out infinite",
        "cart-bounce": "cart-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "orb-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.9" },
        },
        "cart-bounce": {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
