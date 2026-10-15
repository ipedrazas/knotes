// Surveys: a question with options, published once and never changed. To change one you
// clone it into a new survey. Used by the server to check what it's sent, and by the
// client to say what's wrong before anything is sent.

export interface SurveyDraft {
  question: string
  options: string[]
  // Choose as many as you want, rather than one.
  multiple: boolean
  // Everyone sees who voted for what, rather than just the counts.
  named: boolean
  // When voting stops on its own, in ms. The owner can also close it earlier.
  closesAt: number | null
}

export interface Voter {
  name: string
  color: string
}

// A survey as one browser sees it. Results are there once that browser has voted, once
// the survey is closed, and always for its owner.
export interface SurveyView extends SurveyDraft {
  id: string
  createdAt: number
  closed: boolean
  closedAt: number | null
  votes: number
  // What this browser voted for, if it has.
  mine: number[] | null
  owner: boolean
  results: { counts: number[]; voters: Voter[][] | null } | null
}

// A survey in the index.
export interface SurveyMeta {
  id: string
  question: string
  votes: number
  closed: boolean
  updatedAt: number
}

export const LIMITS = { question: 200, option: 100, options: 20 }

const tidy = (text: unknown) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '')

// Blank options are dropped, so a form can send its empty rows.
export function checkDraft(input: unknown, now = Date.now()): { draft: SurveyDraft } | { error: string } {
  const d = (input ?? {}) as Record<string, unknown>
  const question = tidy(d.question)
  if (!question) return { error: 'Ask a question.' }
  if (question.length > LIMITS.question) return { error: `Keep the question under ${LIMITS.question} characters.` }

  const options = Array.isArray(d.options) ? d.options.map(tidy).filter(Boolean) : []
  if (options.length < 2) return { error: 'Give people at least two options.' }
  if (options.length > LIMITS.options) return { error: `That's more than ${LIMITS.options} options.` }
  const long = options.find((o) => o.length > LIMITS.option)
  if (long) return { error: `Keep options under ${LIMITS.option} characters.` }
  const seen = new Set<string>()
  for (const option of options) {
    if (seen.has(option.toLowerCase())) return { error: `“${option}” is in there twice.` }
    seen.add(option.toLowerCase())
  }

  const closesAt = d.closesAt == null || d.closesAt === '' ? null : Math.round(Number(d.closesAt))
  if (closesAt !== null && !(closesAt > now)) return { error: 'The closing time has to be in the future.' }

  return { draft: { question, options, multiple: d.multiple === true, named: d.named === true, closesAt } }
}
