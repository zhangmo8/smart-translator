import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./popup.html', './options.html', './src/**/*.{ts,tsx,css}'],
  theme: {
    extend: {
      colors: {
        ink: '#09090d',
        mist: '#f5f3ef',
        ember: '#f59e0b',
        lagoon: '#5eead4',
        pulse: '#a78bfa',
      },
      boxShadow: {
        panel: '0 24px 80px rgba(15, 23, 42, 0.22)',
      },
      fontFamily: {
        display: ['"Avenir Next"', '"Iowan Old Style"', 'Georgia', 'serif'],
        body: ['"Avenir Next"', '"SF Pro Text"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        noise:
          'radial-gradient(circle at 15% 20%, rgba(255,255,255,0.08) 0, transparent 28%), radial-gradient(circle at 85% 10%, rgba(94,234,212,0.18) 0, transparent 32%), radial-gradient(circle at 30% 80%, rgba(245,158,11,0.15) 0, transparent 35%), linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0))',
      },
    },
  },
  plugins: [],
} satisfies Config;
