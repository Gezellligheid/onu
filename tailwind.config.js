/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        uno: {
          red: '#ED1C24',
          yellow: '#FFD500',
          green: '#3AA655',
          blue: '#0072CE',
          black: '#1a1a1a',
        },
      },
      fontFamily: {
        display: ['"Baloo 2"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'deal-in': {
          '0%': { transform: 'translateY(-40px) scale(0.6)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        'pop': {
          '0%': { transform: 'scale(0.85)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,213,0,0.6)' },
          '50%': { boxShadow: '0 0 0 10px rgba(255,213,0,0)' },
        },
      },
      animation: {
        'deal-in': 'deal-in 0.35s ease-out',
        'pop': 'pop 0.2s ease-out',
        'pulse-glow': 'pulse-glow 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
