import { useId } from 'react'
import type { SurveyView } from '../../shared/survey.ts'
import { Blots, namesOf } from './Blots.tsx'

// The options as boxes to tick: round ones when you choose one, square when you choose many.
export function Ballot(props: {
  question: string
  options: string[]
  multiple: boolean
  chosen: number[]
  onChange: (chosen: number[]) => void
}) {
  const { multiple, chosen, onChange } = props
  const name = useId()
  return (
    <fieldset className="ballot">
      <legend className="sr-only">{props.question}</legend>
      {props.options.map((option, i) => (
        <label key={i} className="ballot__option">
          <input
            type={multiple ? 'checkbox' : 'radio'}
            name={name}
            checked={chosen.includes(i)}
            onChange={(e) =>
              onChange(multiple ? (e.target.checked ? [...chosen, i] : chosen.filter((c) => c !== i)) : [i])
            }
          />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
  )
}

// How everyone voted, as a bar per option, filled to the share of voters who chose it.
// Named surveys show who those voters were.
export function Results(props: {
  options: string[]
  results: NonNullable<SurveyView['results']>
  votes: number
  mine: number[] | null
}) {
  const { results, votes, mine } = props
  return (
    <ol className="tally">
      {props.options.map((option, i) => {
        const count = results.counts[i] ?? 0
        const share = votes ? Math.round((count * 100) / votes) : 0
        const voters = results.voters?.[i] ?? []
        return (
          <li key={i} className={mine?.includes(i) ? 'tally__row is-mine' : 'tally__row'}>
            <div className="tally__label">
              <span className="tally__option">
                {option}
                {mine?.includes(i) && (
                  <span className="tally__tick" title="Your vote">
                    {' '}
                    ✓
                  </span>
                )}
              </span>
              <span className="tally__count">
                {count} · {share}%
              </span>
            </div>
            <div className="tally__bar">
              <span style={{ width: `${share}%` }} />
            </div>
            {voters.length > 0 && (
              <div className="tally__who">
                <Blots people={voters.map((v) => ({ ...v, typing: false }))} small />
                <span>{namesOf(voters)}</span>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export const howToChoose = (multiple: boolean) => (multiple ? 'Choose as many as you like' : 'Choose one')

export const whoSees = (named: boolean) => (named ? 'everyone sees who voted for what' : 'votes are anonymous')
