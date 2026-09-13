// A note's id is also its address, /n/<id>. New notes get a random one (k3j9x0a2bc);
// people can change it to something easier to share, like my-party. Ids are lowercase
// letters, digits and single dashes: safe in URLs and file names, and never containing
// the `--` that separates a note's file name from its id.
export const NOTE_ID = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/

// "Café & Crème: plans!" → "cafe-creme-plans". Empty if nothing usable is left.
export function toAddress(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}
