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
        'ring-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(250,204,21,0.55), 0 0 12px 2px rgba(250,204,21,0.35)' },
          '50%': { boxShadow: '0 0 0 4px rgba(250,204,21,0.25), 0 0 18px 6px rgba(250,204,21,0.55)' },
        },
        'stack-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(237,28,36,0.55), 0 0 12px 2px rgba(237,28,36,0.35)' },
          '50%': { boxShadow: '0 0 0 4px rgba(237,28,36,0.25), 0 0 20px 6px rgba(237,28,36,0.6)' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        'turn-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(250,204,21,0.5)' },
          '50%': { boxShadow: '0 0 0 8px rgba(250,204,21,0)' },
        },
        'flip-in': {
          '0%': { transform: 'rotateY(90deg) scale(0.8)', opacity: '0' },
          '100%': { transform: 'rotateY(0) scale(1)', opacity: '1' },
        },
        'fly-in': {
          '0%': { transform: 'translateY(-60px) scale(0.5)', opacity: '0' },
          '60%': { opacity: '1' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        'chase': {
          '0%, 100%': { opacity: '0.15', transform: 'scale(0.8)' },
          '50%': { opacity: '1', transform: 'scale(1.15)' },
        },
        'flash-yellow': {
          '0%, 100%': { boxShadow: '0 0 0 5px rgba(250,204,21,0.95), 0 0 30px 10px rgba(250,204,21,0.7)' },
          '50%': { boxShadow: '0 0 0 0 rgba(250,204,21,0), 0 0 0 0 rgba(250,204,21,0)' },
        },
        'flash-red': {
          '0%, 100%': { boxShadow: '0 0 0 5px rgba(237,28,36,0.95), 0 0 30px 10px rgba(237,28,36,0.7)' },
          '50%': { boxShadow: '0 0 0 0 rgba(237,28,36,0), 0 0 0 0 rgba(237,28,36,0)' },
        },
      },
      animation: {
        'deal-in': 'deal-in 0.35s ease-out',
        'pop': 'pop 0.2s ease-out',
        'pulse-glow': 'pulse-glow 1.4s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 1.3s ease-in-out infinite',
        'stack-pulse': 'stack-pulse 1s ease-in-out infinite',
        'shake': 'shake 0.4s ease-in-out',
        'turn-ring': 'turn-ring 1.6s ease-in-out infinite',
        'flip-in': 'flip-in 0.3s ease-out',
        'fly-in': 'fly-in 0.4s cubic-bezier(0.2,0.8,0.3,1)',
        'flash-yellow': 'flash-yellow 0.8s steps(1, jump-end) infinite',
        'flash-red': 'flash-red 0.8s steps(1, jump-end) infinite',
      },
    },
  },
  plugins: [],
}
