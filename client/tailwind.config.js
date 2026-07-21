/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand:   { DEFAULT: '#2563eb', dark: '#1d4ed8', light: '#eff6ff', muted: '#dbeafe' },
        manager: { DEFAULT: '#10b981', dark: '#059669', light: '#ecfdf5', muted: '#d1fae5' },
        admin:   { DEFAULT: '#7c3aed', dark: '#6d28d9', light: '#f5f3ff', muted: '#ede9fe' },
        tenant:  { DEFAULT: '#2563eb', dark: '#1e40af', light: '#eff6ff', warm: '#fef3c7' },
      },
      boxShadow: {
        portal: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'portal-lg': '0 10px 40px -10px rgb(0 0 0 / 0.12)',
      },
      backgroundImage: {
        'portal-admin': 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
        'portal-manager': 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
        'portal-tenant': 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        'portal-login': 'linear-gradient(145deg, #1e1b4b 0%, #312e81 40%, #1e3a8a 100%)',
      },
    },
  },
  plugins: [],
};
