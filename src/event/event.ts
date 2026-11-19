import type { ContactEvent } from '../solve/solve'

export type ContactLog = {
  pending: ContactEvent[]
}

export function createContactLog(): ContactLog {
  return { pending: [] }
}

export function recordContacts(log: ContactLog, events: readonly ContactEvent[]): void {
  for (const event of events) {
    if (event.kind !== 'liftoff' && event.kind !== 'landing') throw new Error('kind')
    if (event.foot !== 'left' && event.foot !== 'right') throw new Error('foot')
    log.pending.push({ kind: event.kind, foot: event.foot })
  }
}

export function pullContacts(log: ContactLog): ContactEvent[] {
  const taken = log.pending.slice()
  log.pending = []
  return taken
}
