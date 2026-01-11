/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FDFBF7",
        ink: "#18181B",
        "neon-green": "#CCF381",
        "neon-pink": "#FF5E78",
        "neon-blue": "#4D96FF",
        "alert-red": "#FF2A2A",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
        body: ["'Inter'", "sans-serif"],
      },
      boxShadow: {
        hard: "4px 4px 0px 0px #18181B",
        "hard-sm": "2px 2px 0px 0px #18181B",
        "hard-lg": "8px 8px 0px 0px #18181B",
      },
      backgroundImage: {
        "dot-grid": "radial-gradient(#18181b 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
}
