// Everything the pages need to know that isn't stored in the database.
// Event date, venue, price and the InstaPay link live in fest_settings and are
// edited from /admin, so they can change without a redeploy.
export const API = 'https://ckuiiqfdlvtcfleglqce.supabase.co/functions/v1';
export const XI_SITE = 'https://xi-group-website.vercel.app';
export const SPONSORS_URL = `${XI_SITE}/sponsors`;
export const FACEBOOK = 'https://www.facebook.com/XI.SGWEN';
export const INSTAGRAM = 'https://www.instagram.com/sgwen_11thgroup/';
export const FOUNDED = 1952;
export const YEARS = 74;

export const UNITS = [
  { key: 'buds', ar: 'البراعم', en: 'Buds', agesAr: '3 – 6 سنوات', agesEn: 'Ages 3 – 6', color: 'var(--buds)' },
  { key: 'cubs', ar: 'الأشبال والزهرات', en: 'Cubs & Brownies', agesAr: '6 – 10.5 سنوات', agesEn: 'Ages 6 – 10.5', color: 'var(--cubs)' },
  { key: 'scouts', ar: 'الكشافة والمرشدات', en: 'Scouts & Guides', agesAr: '10.5 – 16 سنة', agesEn: 'Ages 10.5 – 16', color: 'var(--scouts)' },
  { key: 'rovers', ar: 'الجوالة والجوالات', en: 'Rovers & Rangers', agesAr: '16 سنة فأكثر', agesEn: 'Ages 16+', color: 'var(--rovers)' },
] as const;
