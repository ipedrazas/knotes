// Who you are: just a name and an ink colour, kept in this browser. They label your
// cursor and your blot in other people's notebooks.
export interface User {
  name: string
  color: string
}

export const INKS = [
  { name: 'Royal blue', color: '#1f4aa8' },
  { name: 'Red', color: '#b3261e' },
  { name: 'Green', color: '#2e7040' },
  { name: 'Violet', color: '#6b3fa0' },
  { name: 'Sepia', color: '#9a5a1c' },
  { name: 'Teal', color: '#0f7478' },
  { name: 'Magenta', color: '#a3195b' },
  { name: 'Graphite', color: '#454a52' },
]

const KEY = 'knotes:user'
const HEX = /^#[0-9a-f]{6}$/i

export const safeColor = (color: unknown) => (typeof color === 'string' && HEX.test(color) ? color : '#1d2a44')

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

export const randomInk = () => INKS[Math.floor(Math.random() * INKS.length)].color

export function loadUser(): User | null {
  try {
    const user = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof user?.name === 'string' && user.name.trim() && HEX.test(user.color)) return user
  } catch {
    // no storage, or garbage in it: ask again
  }
  return null
}

export function saveUser(user: User) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    // private mode: you'll be asked again next visit
  }
}
