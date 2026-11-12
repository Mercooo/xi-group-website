// Language switching for the bilingual pages. Static text carries both languages
// (see components/T.astro); attributes and script messages are swapped here.
export type Lang = 'ar' | 'en';

export const lang = (): Lang => (document.documentElement.dataset.lang === 'en' ? 'en' : 'ar');

export function applyLang(next?: Lang) {
  const h = document.documentElement;
  const l = next ?? lang();
  h.dataset.lang = l;
  h.lang = l;
  h.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll<HTMLElement>('[data-ph-ar]').forEach((el) => {
    el.setAttribute('placeholder', (l === 'ar' ? el.dataset.phAr : el.dataset.phEn) || '');
  });
  document.querySelectorAll<HTMLElement>('[data-aria-ar]').forEach((el) => {
    el.setAttribute('aria-label', (l === 'ar' ? el.dataset.ariaAr : el.dataset.ariaEn) || '');
  });
  document.dispatchEvent(new CustomEvent('langchange', { detail: l }));
}

/** Pick the active language's string. */
export const t = (ar: string, en: string) => (lang() === 'en' ? en : ar);

const fmtOpts: Intl.DateTimeFormatOptions = { timeZone: 'Africa/Cairo' };

export function formatDate(iso: string, l: Lang = lang()) {
  return new Intl.DateTimeFormat(l === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { ...fmtOpts, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

export function formatTime(iso: string, l: Lang = lang()) {
  return new Intl.DateTimeFormat(l === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { ...fmtOpts, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

export function formatDateTime(iso: string, l: Lang = lang()) {
  return new Intl.DateTimeFormat(l === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { ...fmtOpts, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
