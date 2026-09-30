import { Api } from 'telegram'
import { decode } from '../drive/meta'
import type { DocRef, MessageRecord } from '../drive/tree'

/** Turn a channel message into a record, or null if it isn't TeleDrive data. */
export function toRecord(msg: Api.TypeMessage): MessageRecord | null {
  if (!(msg instanceof Api.Message)) return null
  const meta = decode(msg.message)
  if (!meta) return null
  const record: MessageRecord = { msgId: msg.id, meta, date: msg.date }
  const doc = docRef(msg)
  if (doc) record.doc = doc
  // File parts must carry a document
  if ((meta.t === 'f' || meta.t === 'c') && !record.doc) return null
  return record
}

export function docRef(msg: Api.Message): DocRef | undefined {
  const media = msg.media
  if (!(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)) return undefined
  const d = media.document
  return {
    docId: d.id.toString(),
    accessHash: d.accessHash.toString(),
    fileRef: new Uint8Array(d.fileReference),
    dcId: d.dcId,
    size: d.size.toJSNumber(),
  }
}

/** Messages contained in an Updates response (e.g. after sending or editing). */
export function messagesFromUpdates(res: Api.TypeUpdates): Api.Message[] {
  const updates = 'updates' in res ? res.updates : 'update' in res ? [res.update] : []
  const out: Api.Message[] = []
  for (const u of updates) {
    if (
      (u instanceof Api.UpdateNewChannelMessage || u instanceof Api.UpdateEditChannelMessage) &&
      u.message instanceof Api.Message
    )
      out.push(u.message)
  }
  return out
}
