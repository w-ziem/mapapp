export function normalizeSearch(text) {
  return String(text)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/gi, (letter) => (letter === "Ł" ? "L" : "l"))
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function getRotationDelta(event) {
  if (event.key !== "[" && event.key !== "]") return 0;
  const direction = event.key === "]" ? 1 : -1;
  return direction * (event.shiftKey ? 15 : 1);
}
