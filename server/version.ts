// Which version of FlyDay this is: stamped in when the exe or an update is built
// (e.g. "2026.11.05-1915"); "dev" when running from the source folder.
declare const FLYDAY_BUILD_VERSION: string | undefined;
export const VERSION: string = typeof FLYDAY_BUILD_VERSION === 'string' ? FLYDAY_BUILD_VERSION : 'dev';

/** A version stamp for now, local time: sorts in time order as plain text. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
