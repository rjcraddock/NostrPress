module.exports = {
  content: ["./src/render/templates/**/*.njk", "./src/styles/**/*.css"],
  darkMode: 'class', // Enable dark mode via class
  theme: {
    extend: {}
  },
  plugins: [
    require('@tailwindcss/typography')
  ]
};
