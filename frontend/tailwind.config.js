/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/features/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563eb", // RoundNote 메인 색상
        muted: "#6b7280",
        background: "#ffffff",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};