import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

/**
 * Receives Supabase's Database Webhook payload on every INSERT into
 * `contact_tags`. This is the single point that fires the `tag_added`
 * automation trigger, regardless of which code path created the row
 * (manual UI tagging, CSV import, broadcast tagging, or another
 * automation's `add_tag` step) — a DB-level hook can't be bypassed
 * the way a per-call-site fetch() can.
 *
 * Auth: same shared secret as /api/automations/cron
 * (AUTOMATION_CRON_SECRET), sent as a custom header configured on the
 * Supabase webhook itself.
 *
 * Supabase's default payload shape for INSERT is:
 *   { type: "INSERT", table: "contact_tags", record: {...}, schema: "public", old_record: null }
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const record = payload?.record as { contact_id?: string; tag_id?: string } | undefined
  const contactId = record?.contact_id
  const tagId = record?.tag_id

  if (!contactId) {
    return NextResponse.json({ error: 'missing contact_id in payload' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // contact_tags has no account_id column — resolve it via the contact.
  const { data: contact, error } = await admin
    .from('contacts')
    .select('account_id')
    .eq('id', contactId)
    .maybeSingle()

  if (error) {
    console.error('[tag-added webhook] contact lookup failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!contact?.account_id) {
    console.warn('[tag-added webhook] contact has no account_id, skipping', contactId)
    return NextResponse.json({ ok: true, skipped: true })
  }

  await runAutomationsForTrigger({
    accountId: contact.account_id as string,
    triggerType: 'tag_added',
    contactId,
    context: { tag_id: tagId ?? null },
  })

  return NextResponse.json({ ok: true })
}
