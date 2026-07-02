/**
 * Minimal cron-expression matcher — no external dependency.
 *
 * Supports standard 5-field cron (`minute hour dom month dow`):
 *   *        any value
 *   N        exact value
 *   N,M,...  list
 *   N-M      range (inclusive)
 *   * /N      step (every N units) — written without the space, e.g. STAR/5
 *
 * Also accepts a plain "HH:mm" string as shorthand for "run once a day
 * at that time" (dom/month/dow wildcard), since that's what the
 * automation builder's placeholder ("Cron expression or HH:mm")
 * promises.
 *
 * Field ranges (standard cron, 0-indexed where applicable):
 *   minute       0-59
 *   hour         0-23
 *   day of month 1-31
 *   month        1-12
 *   day of week  0-6 (0 = Sunday)
 *
 * Precision is minute-level: `isCronDue` answers "does this schedule
 * match the given minute?" — the caller (the cron route) is expected
 * to be invoked at least once per minute for this to behave like a
 * real cron.
 */

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/)
    if (stepMatch) {
      const [, base, stepStr] = stepMatch
      const step = parseInt(stepStr, 10)
      let start = min
      let end = max
      if (base !== '*') {
        if (base.includes('-')) {
          const [a, b] = base.split('-').map(Number)
          start = a
          end = b
        } else {
          start = parseInt(base, 10)
          end = max
        }
      }
      for (let v = start; v <= end; v += step) values.add(v)
      continue
    }
    if (part === '*') {
      for (let v = min; v <= max; v++) values.add(v)
      continue
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      for (let v = a; v <= b; v++) values.add(v)
      continue
    }
    const n = parseInt(part, 10)
    if (!Number.isNaN(n)) values.add(n)
  }
  return values
}

/**
 * Returns true if `now` falls within the minute this schedule targets.
 * Returns null if the schedule string couldn't be parsed at all (the
 * caller should treat that as "never due" but log it).
 */
export function isCronDue(schedule: string, now: Date): boolean | null {
  const trimmed = schedule.trim()

  // "HH:mm" shorthand — daily at that time.
  const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) {
    const hour = parseInt(hhmm[1], 10)
    const minute = parseInt(hhmm[2], 10)
    return now.getUTCHours() === hour && now.getUTCMinutes() === minute
  }

  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return null

  try {
    const [minF, hourF, domF, monF, dowF] = fields
    const minutes = parseField(minF, 0, 59)
    const hours = parseField(hourF, 0, 23)
    const doms = parseField(domF, 1, 31)
    const months = parseField(monF, 1, 12)
    const dows = parseField(dowF, 0, 6)

    return (
      minutes.has(now.getUTCMinutes()) &&
      hours.has(now.getUTCHours()) &&
      doms.has(now.getUTCDate()) &&
      months.has(now.getUTCMonth() + 1) &&
      dows.has(now.getUTCDay())
    )
  } catch {
    return null
  }
}

/**
 * True if the automation hasn't already run during the current
 * calendar minute — prevents double-firing if the external pinger
 * calls the cron route more than once within the same minute.
 */
export function notAlreadyRunThisMinute(lastExecutedAt: string | null, now: Date): boolean {
  if (!lastExecutedAt) return true
  const last = new Date(lastExecutedAt)
  return (
    last.getUTCFullYear() !== now.getUTCFullYear() ||
    last.getUTCMonth() !== now.getUTCMonth() ||
    last.getUTCDate() !== now.getUTCDate() ||
    last.getUTCHours() !== now.getUTCHours() ||
    last.getUTCMinutes() !== now.getUTCMinutes()
  )
}
