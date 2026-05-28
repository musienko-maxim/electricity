import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Пошук черги відключень — Черкасиобленерго',
  description:
    'Дізнайтеся, до якої черги погодинних відключень електроенергії належить ваша адреса, організація або ФОП у Черкаській області.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
