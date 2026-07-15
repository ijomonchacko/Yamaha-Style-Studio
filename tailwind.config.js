/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070d",
          900: "#080b14",
          850: "#0b0f1a",
          800: "#0f1422",
          700: "#151c2e",
          600: "#1c2540",
          500: "#2a3658"
        },
        frost: {
          50:  "#f4f7fc",
          100: "#e8eef8",
          200: "#c8d4e8",
          300: "#9aacc8",
          400: "#6b7f9e",
          500: "#4a5d7a"
        },
        cyan: {
          DEFAULT: "#3ecfff",
          soft: "#7ddfff",
          dim: "#1a8fb8",
          glow: "rgba(62, 207, 255, 0.35)"
        },
        violet: {
          DEFAULT: "#a78bfa",
          soft: "#c4b5fd",
          dim: "#6d5bb8",
          glow: "rgba(167, 139, 250, 0.35)"
        },
        amber: {
          DEFAULT: "#f5b942",
          soft: "#fcd34d",
          dim: "#b8860b"
        },
        mint: {
          DEFAULT: "#34d399",
          soft: "#6ee7b7",
          dim: "#059669"
        },
        rose: {
          DEFAULT: "#fb7185",
          soft: "#fda4af",
          dim: "#e11d48"
        },
        panel:   "#0f1422",
        panel2:  "#151c2e",
        edge:    "#243049",
        accent:  "#3ecfff",
        accent2: "#a78bfa",
        good:    "#34d399",
        warn:    "#f5b942",
        bad:     "#fb7185"
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"]
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "0.9rem" }]
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(62,207,255,0.22), 0 12px 40px rgba(62,207,255,0.1)",
        "glow-v": "0 0 0 1px rgba(167,139,250,0.25), 0 12px 40px rgba(167,139,250,0.1)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 32px rgba(0,0,0,0.35)",
        float: "0 20px 50px rgba(0,0,0,0.45)"
      },
      backgroundImage: {
        "mesh":
          "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(62,207,255,0.12), transparent 50%)," +
          "radial-gradient(ellipse 60% 40% at 90% 0%, rgba(167,139,250,0.1), transparent 45%)," +
          "radial-gradient(ellipse 50% 30% at 50% 100%, rgba(245,185,66,0.04), transparent 50%)",
        "card-grad": "linear-gradient(165deg, rgba(28,37,64,0.9) 0%, rgba(15,20,34,0.96) 100%)",
        "btn-cyan": "linear-gradient(135deg, #5ad8ff 0%, #2bb8e8 50%, #1a9fd0 100%)",
        "btn-violet": "linear-gradient(135deg, #b8a0ff 0%, #8b6cf0 55%, #6d4fd4 100%)",
        "brand": "linear-gradient(135deg, #3ecfff 0%, #7c6af0 50%, #f5b942 100%)"
      },
      animation: {
        "fade-up": "fadeUp 0.45s ease-out both",
        "pulse-soft": "pulseSoft 2.4s ease-in-out infinite"
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" }
        }
      }
    }
  },
  plugins: []
};
