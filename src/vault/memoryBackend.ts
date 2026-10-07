import type { ConfigMeta } from '../drive/meta'
import type { MessageRecord } from '../drive/tree'
import type { VaultBackend } from './backend'

/** TeleWarden's messages kept in memory (unit tests and the dev mock), as Telegram would keep them. */
export function memoryBackend(onChange: (records: MessageRecord[]) => void) {
  let records: MessageRecord[] = [{ msgId: 1, date: 0, meta: { td: 1, t: 'cfg', app: 'teledrive' } }]
  let next = 2
  const now = () => Math.floor(Date.now() / 1000)
  const emit = () => onChange([...records])
  const backend: VaultBackend = {
    async send(meta) {
      records = [...records, { msgId: next++, date: now(), meta }]
      emit()
    },
    async edit(msgId, meta) {
      if (!records.some((r) => r.msgId === msgId)) throw new Error('MESSAGE_ID_INVALID')
      records = records.map((r) => (r.msgId === msgId ? { ...r, meta } : r))
      emit()
    },
    async remove(ids) {
      records = records.filter((r) => !ids.includes(r.msgId))
      emit()
    },
    async writeConfig(_drive, w) {
      records = records.map((r) => {
        if (r.meta.t !== 'cfg') return r
        const { w: _old, ...rest } = r.meta
        return { ...r, meta: { ...rest, ...(w && { w }) } as ConfigMeta }
      })
      emit()
    },
    async sync() {},
  }
  return {
    backend,
    records: () => records,
    /** Another device changes the channel. */
    replace(list: MessageRecord[]) {
      records = list
      emit()
    },
    emit,
  }
}
