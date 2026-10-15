import { useState, type ReactNode } from 'react'
import { qrCodeUrl } from '../api.ts'

// Copy to the clipboard: true if it worked. There's no clipboard outside https (or
// localhost), and the browser can say no.
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// An index card for passing a page on: its link, and a QR code taped on so a phone
// across the table can open the same page.
export function ShareCard(props: { url: string; hint: string; onClose: () => void; children?: ReactNode }) {
  const { url } = props
  const [copied, setCopied] = useState<boolean | null>(null)
  const [broken, setBroken] = useState(false)

  async function copy() {
    setCopied(await copyText(url))
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="card" role="dialog" aria-label="Share this page" onClick={(e) => e.stopPropagation()}>
        <h2>Pass it on</h2>
        <p className="card__hint">{props.hint}</p>
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
        {props.children}
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
