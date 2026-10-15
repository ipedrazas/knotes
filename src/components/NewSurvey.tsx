import { useEffect, useState } from 'react'
import { toAddress } from '../../shared/address.ts'
import { checkDraft, LIMITS } from '../../shared/survey.ts'
import { fetchSurvey, longDate, navigate, publishSurvey } from '../api.ts'
import { Ballot, howToChoose, whoSees } from './Ballot.tsx'

// Writing a survey, then seeing it as voters will before publishing it. Once it's
// published it can't be changed, so the preview is the last chance to fix a typo.
// /s/new?from=<id> starts from a copy of another survey's question and options.
export function NewSurvey() {
  const [from] = useState(() => new URLSearchParams(location.search).get('from'))
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [named, setNamed] = useState(false)
  const [closes, setCloses] = useState('')
  const [address, setAddress] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [tried, setTried] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'New survey · knotes'
    if (!from) return
    fetchSurvey(from)
      .then((survey) => {
        if (!survey) return
        setQuestion(survey.question)
        setOptions(survey.options)
        setMultiple(survey.multiple)
        setNamed(survey.named)
      })
      .catch(() => {})
  }, [from])

  // datetime-local is in this browser's time zone, and so is new Date() reading it.
  const closesAt = closes ? new Date(closes).getTime() : null
  const checked = checkDraft({ question, options, multiple, named, closesAt })
  const path = toAddress(address)

  async function publish() {
    if ('error' in checked) return
    setBusy(true)
    setError(null)
    try {
      const survey = await publishSurvey(checked.draft, path)
      navigate(`/s/${survey.id}`, true)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const head = (
    <header className="sheet__head">
      <button className="back" onClick={() => navigate('/')}>
        ‹ Index
      </button>
      <div className="sheet__when">
        <span className="sheet__date">{from ? 'A copy of another survey' : 'A new survey'}</span>
        <p className="writing-now">{previewing ? 'This is how people will see it' : 'Ask the notebook something'}</p>
      </div>
      <span className="stamp stamp--opening">Draft</span>
    </header>
  )

  if (previewing && 'draft' in checked) {
    const { draft } = checked
    return (
      <section className="sheet" aria-label="Survey preview">
        {head}
        <div className="paper">
          <div className="paper__lines survey">
            <h2 className="survey__question">{draft.question}</h2>
            <p className="survey__how">
              {howToChoose(draft.multiple)} · {whoSees(draft.named)}
            </p>
            <Ballot
              question={draft.question}
              options={draft.options}
              multiple={draft.multiple}
              chosen={tried}
              onChange={setTried}
            />
            <p className="survey__small">
              {draft.closesAt ? `Voting closes ${longDate(draft.closesAt)}.` : 'Voting stays open until you close it.'}{' '}
              {path ? `It’ll be at /s/${path}.` : ''}
            </p>
            <p className="survey__warning">
              Once it’s published it can’t be changed. To fix something afterwards, you’d clone it into a new survey.
            </p>
            {error && <p className="survey__error">{error}</p>}
            <div className="survey__actions">
              <button type="button" className="link-btn" onClick={() => setPreviewing(false)}>
                Keep editing
              </button>
              <button type="button" className="stamp-btn" disabled={busy} onClick={publish}>
                Publish
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="sheet" aria-label="New survey">
      {head}
      <div className="paper">
        <form
          className="paper__lines survey survey--draft"
          onSubmit={(e) => {
            e.preventDefault()
            if ('draft' in checked) {
              setTried([])
              setPreviewing(true)
            }
          }}
        >
          <label className="survey__field">
            <span className="survey__label">The question</span>
            <input
              className="survey__question-input"
              autoFocus
              maxLength={LIMITS.question}
              placeholder="Where shall we go?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>

          <fieldset className="survey__field">
            <legend className="survey__label">The options</legend>
            <ol className="survey__options">
              {options.map((option, i) => (
                <li key={i}>
                  <input
                    maxLength={LIMITS.option}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                    value={option}
                    onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      className="tool tool--danger"
                      aria-label={`Remove option ${i + 1}`}
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {options.length < LIMITS.options && (
              <button type="button" className="link-btn" onClick={() => setOptions([...options, ''])}>
                + Add an option
              </button>
            )}
          </fieldset>

          <fieldset className="survey__field survey__choice">
            <legend className="survey__label">People can</legend>
            <label>
              <input type="radio" name="multiple" checked={!multiple} onChange={() => setMultiple(false)} /> choose one
            </label>
            <label>
              <input type="radio" name="multiple" checked={multiple} onChange={() => setMultiple(true)} /> choose as
              many as they like
            </label>
          </fieldset>

          <fieldset className="survey__field survey__choice">
            <legend className="survey__label">Votes are</legend>
            <label>
              <input type="radio" name="named" checked={!named} onChange={() => setNamed(false)} /> anonymous: only
              the counts show
            </label>
            <label>
              <input type="radio" name="named" checked={named} onChange={() => setNamed(true)} /> named: everyone sees
              who voted for what
            </label>
          </fieldset>

          <label className="survey__field">
            <span className="survey__label">Close it automatically (optional)</span>
            <input
              className="survey__when"
              type="datetime-local"
              value={closes}
              onChange={(e) => setCloses(e.target.value)}
            />
            <span className="survey__small">Leave it empty to keep it open until you close it.</span>
          </label>

          <label className="survey__field">
            <span className="survey__label">Address (optional)</span>
            <span className="address">
              <span className="address__host">{location.host}/s/</span>
              <input
                maxLength={80}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="where-to"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </span>
          </label>

          <p className="survey__error" aria-live="polite">
            {question.trim() && 'error' in checked ? checked.error : ' '}
          </p>
          <div className="survey__actions">
            <button type="button" className="link-btn" onClick={() => navigate('/')}>
              Never mind
            </button>
            <button type="submit" className="stamp-btn" disabled={'error' in checked}>
              Preview
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
