/** Returns `items` plus `item`, dropping the oldest entries beyond `max`. */
export function appendCapped<T>(items: T[], item: T, max: number): T[] {
  return items.length >= max ? [...items.slice(items.length - max + 1), item] : [...items, item];
}
