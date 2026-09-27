/**
 * Theatre mode lives on <html data-theatre>, which the layout's bootstrap
 * script sets before first paint. These helpers are the only writers, so the
 * control-bar button and the "t" shortcut can never disagree.
 */
export const THEATRE_KEY = "quiet-theatre";
export const THEATRE_EVENT = "quiet:theatre";

export function isTheatre(): boolean {
  return document.documentElement.hasAttribute("data-theatre");
}

export function setTheatre(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute("data-theatre", "");
  else root.removeAttribute("data-theatre");
  try {
    localStorage.setItem(THEATRE_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the toggle still works for this visit.
  }
  window.dispatchEvent(new Event(THEATRE_EVENT));
}
