/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Karnataka State Police identity — drawn from the emblem + marching uniforms
        ksp: {
          saffron: "#F98125",
          gold: "#E7B24B",
          red: "#C43B2E",
          navy: "#0A1024",
          khaki: "#CBB98C",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.37), inset 0 1px 0 rgba(255,255,255,0.06)",
        "glass-lg": "0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
        neo: "6px 6px 16px rgba(0,0,0,0.55), -6px -6px 16px rgba(255,255,255,0.035)",
        "neo-inset": "inset 4px 4px 10px rgba(0,0,0,0.55), inset -4px -4px 10px rgba(255,255,255,0.035)",
        glow: "0 0 0 1px rgba(231,178,75,0.30), 0 10px 34px rgba(231,178,75,0.16)",
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
