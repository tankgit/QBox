/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0f172a",
        accent: "#60a5fa",
        accentSoft: "#a855f7"
      },
      backdropBlur: {
        xs: "2px",
        soft: "12px"
      }
    }
  },
  plugins: []
};

