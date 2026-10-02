export function PipMascot({ celebrate = false }: { celebrate?: boolean }) {
  return <svg className={`pip-mascot ${celebrate ? "pip-mascot--happy" : ""}`} viewBox="0 0 150 145" aria-hidden="true">
    <ellipse cx="77" cy="132" rx="47" ry="8" fill="#29263d" opacity=".12"/>
    <path d="M47 108l-9 19h23l8-18m23-1 13 19h20l-15-25" fill="#29263d" stroke="#29263d" strokeWidth="5" strokeLinejoin="round"/>
    <path d="M27 75 12 62m110 9 16-20" stroke="#29263d" strokeWidth="9" strokeLinecap="round"/>
    <path d="m66 24 4-13 13 3" fill="none" stroke="#29263d" strokeWidth="5" strokeLinecap="round"/>
    <circle cx="84" cy="14" r="7" fill="#ff896e" stroke="#29263d" strokeWidth="3"/>
    <rect x="25" y="28" width="103" height="86" rx="30" fill="#b9a3ff" stroke="#29263d" strokeWidth="4"/>
    <rect x="37" y="43" width="79" height="48" rx="18" fill="#fffcef" stroke="#29263d" strokeWidth="3"/>
    <path d={celebrate ? "M49 63q7-12 14 0m22 0q7-12 14 0" : "M55 59v7m37-7v7"} fill="none" stroke="#29263d" strokeWidth="6" strokeLinecap="round"/>
    <path d="M68 76q9 8 18 0" fill="none" stroke="#29263d" strokeWidth="3" strokeLinecap="round"/>
    <circle cx="50" cy="76" r="5" fill="#ffa08b"/><circle cx="101" cy="76" r="5" fill="#ffa08b"/>
    <path d="M64 101h24" stroke="#29263d" strokeWidth="4" strokeLinecap="round"/>
  </svg>;
}
