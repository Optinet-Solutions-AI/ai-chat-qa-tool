import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Montserrat', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        accent: '#4f8ef7',
        accent2: '#7c3aed',
        bg: '#f6f7fb',
        bg2: '#eff3f7',
        bg3: '#e2e8f0',
        bg4: '#cbd5e1',
        text1: '#0f1419',
        text2: '#444652',
        text3: '#888fa0',
      },
    },
  },
  plugins: [],
};

export default config;
