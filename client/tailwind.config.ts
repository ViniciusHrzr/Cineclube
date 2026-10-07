import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        house: {
          DEFAULT: '#07090e',
          deep: '#04050a',
          seat: '#0e121b',
          rail: '#18202e',
        },
        beam: {
          DEFAULT: '#ffe9c4',
          hot: '#fff6e6',
          dim: '#8d8574',
        },
        dye: {
          red: '#d12a20',
          'red-hot': '#e2352a',
          'red-lit': '#f2564a',
          'red-glow': '#ff7a6e',
          'red-deep': '#8c1e18',
          brass: '#d9a441',
          'brass-deep': '#7a5a1e',
          green: '#2f9e44',
          'green-lit': '#5fd48a',
        },
        ink: {
          DEFAULT: '#eae4d8',
          dim: '#9d9686',
          faint: '#5b564c',
        },
      },
      fontFamily: {
        display: ['Staatliches', '"Bebas Neue"', 'system-ui', 'sans-serif'],
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        cell: '2px',
        plate: '6px',
      },
      transitionTimingFunction: {
        beam: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'frame-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'beam-in': {
          from: { opacity: '0', transform: 'scale(0.985) translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '48%': { opacity: '0.86' },
          '52%': { opacity: '1' },
        },
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.4)' },
          '55%': { opacity: '1', transform: 'scale(1.25)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        lamp: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 10px rgba(242,86,74,0.85)' },
          '50%': { opacity: '0.66', boxShadow: '0 0 4px rgba(242,86,74,0.3)' },
        },
        bulb: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.28' },
        },
        nudge: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '15%': { transform: 'rotate(-11deg)' },
          '35%': { transform: 'rotate(9deg)' },
          '55%': { transform: 'rotate(-6deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
      },
      animation: {
        'frame-in': 'frame-in 320ms cubic-bezier(0.16,1,0.3,1) backwards',
        'beam-in': 'beam-in 260ms cubic-bezier(0.16,1,0.3,1)',
        flicker: 'flicker 4s ease-in-out infinite',
        pop: 'pop 420ms cubic-bezier(0.16,1,0.3,1)',
        lamp: 'lamp 2.4s ease-in-out infinite',
        bulb: 'bulb 2.8s ease-in-out infinite',
        nudge: 'nudge 640ms ease-in-out',
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
      addVariant('fine', '@media (hover: hover) and (pointer: fine)');
    }),
  ],
} satisfies Config;
