import { useState } from 'react'
import { noteUrl, qrCodeUrl } from '../api.ts'

// An index card for passing a page on: its link, and a QR code taped on so a phone
// across the table can open the same page.
export function ShareCard(props: { id: string; onClose: () => void }) {
  const url = noteUrl(props.id)
  const [copied, setCopied] = useState<boolean | null>(null)
  const [broken, setBroken] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // No clipboard outside https (or localhost), or the browser said no.
      setCopied(false)
    }
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="card" role="dialog" aria-label="Share this page" onClick={(e) => e.stopPropagation()}>
        <h2>Pass it on</h2>
        <p className="card__hint">Point a phone at the code, or send the link. Anyone with it can write here too.</p>
        <div className={broken ? 'share__qr share__qr--broken' : 'share__qr'}>
          {broken ? (
            <span>The code wouldn't draw. The link below still works.</span>
          ) : (
            <img src={qrCodeUrl(url)} width="210" height="210" alt={`QR code for ${url}`} onError={() => setBroken(true)} />
          )}
        </div>
        <a className="share__link" href={url}>
          {url}
        </a>
        <p className={copied === false ? 'card__note card__note--error' : 'card__note'} aria-live="polite">
          {copied === null ? ' ' : copied ? 'Copied.' : "Couldn't copy. Select the link above instead."}
        </p>
        <div className="card__actions">
          <button type="button" className="link-btn" onClick={props.onClose}>
            Done
          </button>
          <button type="button" className="stamp-btn" autoFocus onClick={copy}>
            Copy link
          </button>
        </div>
      </div>
    </div>
  )
}
