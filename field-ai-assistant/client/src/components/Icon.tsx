export type IconName = 'spark' | 'box' | 'history' | 'camera' | 'mic' | 'arrow' | 'check' | 'close' | 'chair' | 'desk' | 'monitor' | 'stop';
const paths: Record<IconName, React.ReactNode> = {
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z"/></>,
  box: <><path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M7 5l10 4"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/></>,
  camera: <><path d="M8 5 6 8H3v12h18V8h-3l-2-3H8Z"/><circle cx="12" cy="14" r="3"/></>,
  mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  chair: <><path d="M7 4h10v9H7V4Zm-2 9h14v4H5v-4Zm7 4v4m-5 0h10M4 9v4m16-4v4"/></>,
  desk: <path d="M3 7h18v4H3V7Zm2 4v10m14-10v10M5 15h14"/>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="1"/><path d="M12 17v4m-5 0h10"/></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="1"/>,
};
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
