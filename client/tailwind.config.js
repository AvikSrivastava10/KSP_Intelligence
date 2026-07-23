/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ksp: { saffron: "#f97316", gold: "#d97706", red: "#dc2626", navy: "#0f172a", khaki: "#a16207" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        glass: "0 1px 2px rgba(15,23,42,0.04), 0 10px 30px rgba(15,23,42,0.07)",
        "glass-lg": "0 12px 44px rgba(15,23,42,0.12)",
        neo: "5px 5px 12px rgba(174,179,190,0.55), -5px -5px 12px rgba(255,255,255,0.9)",
        "neo-inset": "inset 4px 4px 9px rgba(174,179,190,0.5), inset -4px -4px 9px rgba(255,255,255,0.9)",
        glow: "0 0 0 1px rgba(99,102,241,0.35), 0 10px 30px rgba(99,102,241,0.18)",
      },
      keyframes: {
        fadeUp: { "0%": { opacity: 0, transform: "translateY(24px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        pulseGlow: { "0%,100%": { opacity: 0.55 }, "50%": { opacity: 1 } },
      },
      animation: {
        "fade-up": "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) both",
        floaty: "floaty 7s ease-in-out infinite",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
