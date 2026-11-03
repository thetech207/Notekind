/* Date-note path helpers — same convention as Tektite:
   YYYY/MM - Month/YYYY-MM-DD.md */
export const MONTHS = ['January','February','March','April','May','June','July',
                       'August','September','October','November','December'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const pad = n => String(n).padStart(2, '0');

/* [year, month-dir, filename] for a date */
export const parts = d => [
  String(d.getFullYear()),
  pad(d.getMonth() + 1) + ' - ' + MONTHS[d.getMonth()],
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`
];

export const dayPath = d => parts(d).join('/');
export const dayLabel = d =>
  `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} - ${WEEKDAYS[d.getDay()]}`;

export const isDateName = base => /^\d{4}-\d{2}-\d{2}$/.test(base);

/* Vault path for a YYYY-MM-DD basename (so [[2026-11-03]] links and
   bare date names land in their month folder) */
export function dateNamePath(base) {
  const [y, m] = base.split('-');
  return `${y}/${m} - ${MONTHS[+m - 1]}/${base}.md`;
}
