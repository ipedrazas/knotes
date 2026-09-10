import type { CSSProperties } from 'react'
import { initials, safeColor } from '../user.ts'

interface Person {
  name: string
  color: string
  typing: boolean
}

const MAX = 5

// People as ink blots with their initials; a scribbling pen marks whoever is typing.
export function Blots({ people, small = false }: { people: Person[]; small?: boolean }) {
  if (people.length === 0) return null
  const shown = people.slice(0, MAX)
  return (
    <ul className={small ? 'blots blots--sm' : 'blots'}>
      {shown.map((p, i) => (
        <li
          key={i}
          className={p.typing ? 'blot is-typing' : 'blot'}
          style={{ '--c': safeColor(p.color) } as CSSProperties}
          title={p.typing ? `${p.name} is writing…` : p.name}
        >
          {initials(p.name)}
        </li>
      ))}
      {people.length > MAX && <li className="blot blot--more">+{people.length - MAX}</li>}
    </ul>
  )
}

// "Ana is writing…", "Ana and Bo are writing…", "Ana, Bo and 2 others are writing…"
export function namesOf(people: { name: string }[]) {
  const names = people.map((p) => p.name)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} other${names.length > 3 ? 's' : ''}`
}
