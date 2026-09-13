import { useState } from 'react'
import { toAddress } from '../../shared/address.ts'
import { navigate, renameNote } from '../api.ts'

// An index card for giving a page an address people can remember: /n/my-party
// rather than /n/k3j9x0a2bc. Links to the old address keep working.
export function AddressCard(props: { id: string; onClose: () => void }) {
  const [text, setText] = useState(props.id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const address = toAddress(text)

  async function save() {
    setBusy(true)
    try {
      const note = await renameNote(props.id, address)
      // The page remounts under its new address, and this card goes with it.
      navigate(`/n/${note.id}`, true)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <form
        className="card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (address && address !== props.id) void save()
        }}
      >
        <h2>Give it an address</h2>
        <p className="card__hint">Something easy to remember and share. Old links keep working.</p>
        <label className="address">
          <span className="address__host">{location.host}/n/</span>
          <input
            autoFocus
            maxLength={80}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-label="Address"
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
          />
        </label>
        <p className={error ? 'card__note card__note--error' : 'card__note'} aria-live="polite">
          {error ?? (address !== text.trim() ? (address ? `It'll be /n/${address}` : 'Use letters or numbers.') : ' ')}
        </p>
        <div className="card__actions">
          <button type="button" className="link-btn" onClick={props.onClose}>
            Never mind
          </button>
          <button type="submit" className="stamp-btn" disabled={busy || !address || address === props.id}>
            Change it
          </button>
        </div>
      </form>
    </div>
  )
}
