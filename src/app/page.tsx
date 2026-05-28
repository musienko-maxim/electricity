import { SearchBox } from '@/components/SearchBox';

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
            Пошук черги відключень електроенергії
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600">
            Дані з графіків АТ «Черкасиобленерго». Введіть свою адресу, назву організації, ФОП або призвище —
            ми покажемо, до якої черги та підчерги ви належите.
          </p>
        </header>
        <div className="flex justify-center">
          <SearchBox />
        </div>
        <footer className="mt-12 text-xs text-slate-500 text-center">
          MVP-ітерація: один PDF (1 черга, І підчерга). Наступні ітерації — повний набір (12 PDF).
        </footer>
      </div>
    </main>
  );
}
