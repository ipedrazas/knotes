import { useState, type CSSProperties } from 'react'
import { INKS, randomInk, type User } from '../user.ts'

// An index card asking who you are. There are no accounts: the name is just a label.
export function WhoCard(props: { initial: User | null; onSave: (u: User) => void; onCancel?: () => void }) {
  const [name, setName] = useState(props.initial?.name ?? '')
  const [color, setColor] = useState(props.initial?.color ?? randomInk)

  return (
    <div className="overlay" onClick={props.onCancel}>
      <form
        className="card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) props.onSave({ name: name.trim().slice(0, 32), color })
        }}
      >
        <h2>Who's writing?</h2>
        <p className="card__hint">Your name goes on your cursor, so everyone can see who's scribbling where.</p>
        <label className="card__name">
          <span className="sr-only">Your name</span>
          <input
            autoFocus
            maxLength={32}
            placeholder="Your name"
            value={name}
            style={{ color }}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="inks">
          <legend>Pick your ink</legend>
          {INKS.map((ink) => (
            <label key={ink.color} className="ink" style={{ '--c': ink.color } as CSSProperties} title={ink.name}>
              <input
                type="radio"
                name="ink"
                value={ink.color}
                checked={color === ink.color}
                onChange={() => setColor(ink.color)}
              />
              <span className="sr-only">{ink.name}</span>
            </label>
          ))}
        </fieldset>
        <div className="card__actions">
          {props.onCancel && (
            <button type="button" className="link-btn" onClick={props.onCancel}>
              Never mind
            </button>
          )}
          <button type="submit" className="stamp-btn" disabled={!name.trim()}>
            Start writing
          </button>
        </div>
      </form>
    </div>
  )
}
