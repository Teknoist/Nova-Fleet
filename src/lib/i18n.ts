export type Language = "tr" | "en";

const STORAGE_KEY = "nova-fleet-language";

export function detectLanguage(): Language {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "tr" || saved === "en") return saved;
  return window.navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function applyLanguage(language: Language) {
  document.documentElement.lang = language;
  window.localStorage.setItem(STORAGE_KEY, language);
}

export function tr(turkish: string, english: string) {
  return document.documentElement.lang === "en" ? english : turkish;
}
