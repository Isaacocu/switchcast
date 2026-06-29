/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#e60012',
        'bg-primary': '#0a0a0a',
        'bg-secondary': '#1a1a1a',
        'bg-card': '#222222',
        accent: '#e60012',
        'text-primary': '#f5f5f5',
        'text-secondary': '#a0a0a0',
        'border-main': '#333333'
      }
    }
  },
  plugins: []
}
