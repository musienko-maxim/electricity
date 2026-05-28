'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Building2, User, Briefcase, Search } from 'lucide-react';
import type { ItemKind, SearchKindFilter, SearchResponse, SearchResultRow } from '@/lib/types';

const CHIPS: Array<{ id: SearchKindFilter; label: string }> = [
  { id: 'all', label: 'Усі' },
  { id: 'address', label: 'Адреса' },
  { id: 'org', label: 'Організація' },
  { id: 'fop', label: 'ФОП' },
  { id: 'person', label: 'Особа' },
];

const KIND_META: Record<ItemKind, { label: string; icon: React.ReactNode; color: string }> = {
  street:               { label: 'вулиця',     icon: <MapPin className="w-3.5 h-3.5" />,    color: 'bg-blue-100 text-blue-800' },
  street_with_numbers:  { label: 'адреса',     icon: <MapPin className="w-3.5 h-3.5" />,    color: 'bg-blue-100 text-blue-800' },
  settlement:           { label: 'нас. пункт', icon: <MapPin className="w-3.5 h-3.5" />,    color: 'bg-emerald-100 text-emerald-800' },
  organization:         { label: 'організація', icon: <Building2 className="w-3.5 h-3.5" />, color: 'bg-amber-100 text-amber-800' },
  fop:                  { label: 'ФОП',        icon: <Briefcase className="w-3.5 h-3.5" />, color: 'bg-purple-100 text-purple-800' },
  person:               { label: 'особа',      icon: <User className="w-3.5 h-3.5" />,      color: 'bg-rose-100 text-rose-800' },
};

const PAGE_SIZE = 15;

export function SearchBox() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<SearchKindFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // Reset to page 1 when query or kind changes.
  useEffect(() => { setPage(1); }, [q, kind]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = new URL('/api/search', window.location.origin);
        url.searchParams.set('q', term);
        url.searchParams.set('kind', kind);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', String(PAGE_SIZE));
        const res = await fetch(url.toString());
        if (myId !== reqIdRef.current) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const json: SearchResponse = await res.json();
        setData(json);
        setError(null);
      } catch (e) {
        if (myId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : 'Помилка пошуку');
        setData(null);
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const showDropdown = q.trim().length >= 2;

  return (
    <div className="w-full max-w-3xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Введіть адресу, назву організації, ФОП або призвище…"
          className="w-full pl-10 pr-10 py-3 text-base bg-white border border-slate-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 placeholder:text-slate-400"
          autoComplete="off"
          aria-label="Пошук"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 animate-spin" aria-hidden />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {CHIPS.map((c) => {
          const active = kind === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setKind(c.id)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                active
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
              aria-pressed={active}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {showDropdown && (
        <div className="mt-3 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {error ? (
            <div className="px-4 py-6 text-rose-700 text-sm">Помилка: {error}</div>
          ) : !data ? (
            <SkeletonRows />
          ) : data.results.length === 0 ? (
            <div className="px-4 py-6 text-slate-600 text-sm">
              Нічого не знайдено для «<span className="font-medium">{q}</span>».
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
                {data.results.map((row) => (
                  <ResultRow key={row.id} row={row} />
                ))}
              </ul>
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← Назад
                </button>
                <span>
                  Сторінка <strong>{data.page}</strong> з <strong>{totalPages}</strong>
                  {' · '}
                  знайдено <strong>{data.total}</strong>
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Далі →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ row }: { row: SearchResultRow }) {
  const meta = KIND_META[row.kind];
  return (
    <li className="px-4 py-3 hover:bg-slate-50">
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ${meta.color}`}
          title={meta.label}
        >
          {meta.icon}
          {meta.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900 truncate">{row.displayName}</div>
          <div className="text-xs text-slate-600 mt-0.5">
            <span className="font-medium text-slate-800">{row.queue.label}</span>
            {' · '}
            {row.filia}
            {row.queue.validFrom && row.queue.validTo && (
              <>
                {' · '}
                діє {formatDate(row.queue.validFrom)}–{formatDate(row.queue.validTo)}
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="divide-y divide-slate-100">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="px-4 py-3">
          <div className="h-3 bg-slate-200 rounded w-1/3 mb-2 animate-pulse" />
          <div className="h-3 bg-slate-100 rounded w-2/3 animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
