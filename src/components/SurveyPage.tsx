import { useEffect, useState } from 'react'
import type { SurveyMeta, SurveyView } from '../../shared/survey.ts'
import {
  adoptOwnerLink,
  closeSurvey,
  deleteSurvey,
  fetchSurvey,
  longDate,
  navigate,
  NEW_SURVEY,
  ownerUrl,
  surveyUrl,
  vote,
} from '../api.ts'
import type { User } from '../user.ts'
import { Ballot, howToChoose, Results, whoSees } from './Ballot.tsx'
import { copyText, ShareCard } from './ShareCard.tsx'

interface Props {
  id: string
  // From the live index: when it changes (a vote, closing), the survey is fetched again.
  meta: SurveyMeta | undefined
  user: User
  onGone: (message: string) => void
}

// A published survey: vote, see how everyone voted, and pass it on. It can't be edited,
// only cloned into a new one. Whoever published it can close it early or tear it out.
export function SurveyPage({ id, meta, user, onGone }: Props) {
  const [view, setView] = useState<SurveyView | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const stamp = meta && `${meta.updatedAt}:${meta.votes}:${meta.closed}`

  useEffect(() => {
    adoptOwnerLink(id)
    let current = true
    fetchSurvey(id)
      .then((survey) => {
        if (!current) return
        if (survey) setView(survey)
        else setMissing(true)
      })
      .catch((err) => current && setError((err as Error).message))
    return () => {
      current = false
    }
  }, [id, stamp])

  useEffect(() => {
    document.title = view ? `${view.question} · knotes` : 'knotes'
  }, [view])

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cast = () =>
    act(async () => {
      setView(await vote(id, picked, user))
      setChanging(false)
    })

  const close = () => {
    if (!confirm('Close this survey now? Nobody can vote after this, and it can’t be reopened.')) return
    void act(async () => setView(await closeSurvey(id)))
  }

  const tearOut = () => {
    if (!confirm('Tear this survey out of the notebook? It goes to the trash folder on the server.')) return
    void act(async () => {
      await deleteSurvey(id)
      onGone('Survey torn out.')
      navigate('/')
    })
  }

  if (missing) {
    return (
      <section className="sheet sheet--blank">
        <div className="blank">
          <p className="blank__hand">This survey isn't in the notebook.</p>
          <button className="stamp-btn" onClick={() => navigate('/')}>
            Back to the index
          </button>
        </div>
      </section>
    )
  }
  if (!view) return <section className="sheet">{error && <p className="survey__error">{error}</p>}</section>

  const canVote = !view.closed && (!view.mine || changing)
  const showResults = view.results && (!canVote || view.owner)

  return (
    <section className="sheet" aria-label={view.question}>
      <header className="sheet__head">
        <button className="back" onClick={() => navigate('/')}>
          ‹ Index
        </button>
        <div className="sheet__when">
          <time className="sheet__date">Asked {longDate(view.createdAt)}</time>
          <p className="writing-now">
            {view.votes} vote{view.votes === 1 ? '' : 's'} ·{' '}
            {view.closed && view.closedAt
              ? `closed ${longDate(view.closedAt)}`
              : view.closesAt
                ? `closes ${longDate(view.closesAt)}`
                : 'open until it’s closed'}
          </p>
        </div>
        <span className={view.closed ? 'stamp stamp--offline' : 'stamp stamp--synced'}>
          {view.closed ? 'Closed' : 'Open'}
        </span>
        <div className="sheet__actions">
          <button className="tool" onClick={() => setSharing(true)} title="Share this survey: its link and a QR code">
            Share
          </button>
          <button
            className="tool"
            onClick={() => navigate(`${NEW_SURVEY}?from=${id}`)}
            title="Start a new survey from a copy of this one"
          >
            Clone
          </button>
          {view.owner && !view.closed && (
            <button className="tool" onClick={close} disabled={busy} title="Stop the voting now">
              Close
            </button>
          )}
          {view.owner && (
            <button className="tool tool--danger" onClick={tearOut} disabled={busy} title="Delete this survey">
              Tear out
            </button>
          )}
        </div>
      </header>
      <div className="paper">
        <div className="paper__lines survey">
          <h2 className="survey__question">{view.question}</h2>
          <p className="survey__how">
            {howToChoose(view.multiple)} · {whoSees(view.named)}
          </p>

          {canVote && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (picked.length) void cast()
              }}
            >
              <Ballot
                question={view.question}
                options={view.options}
                multiple={view.multiple}
                chosen={picked}
                onChange={setPicked}
              />
              <div className="survey__actions">
                <button type="submit" className="stamp-btn" disabled={busy || picked.length === 0}>
                  {view.mine ? 'Change my vote' : 'Vote'}
                </button>
                {changing && (
                  <button type="button" className="link-btn" onClick={() => setChanging(false)}>
                    Never mind
                  </button>
                )}
              </div>
            </form>
          )}

          {error && <p className="survey__error">{error}</p>}

          {showResults && view.results ? (
            <>
              {canVote && <h3 className="survey__so-far">So far</h3>}
              <Results options={view.options} results={view.results} votes={view.votes} mine={view.mine} />
            </>
          ) : (
            canVote && <p className="survey__hint">Vote to see how everyone else voted.</p>
          )}

          {!canVote && view.mine && !view.closed && (
            <button
              className="link-btn"
              onClick={() => {
                setPicked(view.mine ?? [])
                setChanging(true)
              }}
            >
              Change my vote
            </button>
          )}

          <p className="survey__small">
            {view.closed
              ? 'This survey is closed. To ask again, clone it.'
              : 'One vote per browser. You can change yours until the survey closes.'}
          </p>
        </div>
      </div>
      {sharing && (
        <ShareCard
          url={surveyUrl(id)}
          hint="Point a phone at the code, or send the link. Anyone with it can vote."
          onClose={() => setSharing(false)}
        >
          {view.owner && <OwnerLink id={id} />}
        </ShareCard>
      )}
    </section>
  )
}

// The owner token lives in this browser. The owner link takes it to another one.
function OwnerLink({ id }: { id: string }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const url = ownerUrl(id)
  if (!url) return null
  return (
    <div className="share__owner">
      <p className="card__hint">
        You published this. Your owner link lets another browser close or delete it, so keep it to yourself.
      </p>
      <button type="button" className="link-btn" onClick={async () => setCopied(await copyText(url))}>
        Copy owner link
      </button>
      <span className="card__note" aria-live="polite">
        {copied === null ? '' : copied ? ' Copied.' : ` Couldn’t copy. Here it is: ${url}`}
      </span>
    </div>
  )
}
