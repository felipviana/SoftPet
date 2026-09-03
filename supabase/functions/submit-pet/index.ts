import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_MANIFEST = 128 * 1024
const MAX_SHEET = 8 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/webp', 'image/gif'])

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })

const clean = (value: string, fallback: string, max: number): string => {
  const result = value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, max)
  return result || fallback
}

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'pet'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'apikey, content-type',
      },
    })
  }
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (request.method === 'GET') {
      const name = clean(new URL(request.url).searchParams.get('name') ?? '', '', 80)
      if (!name) return json({ error: 'Informe o nome do pet.' }, 400)
      const checked = await supabase.rpc('community_pet_name_available', { candidate: name })
      if (checked.error) throw checked.error
      return json({ available: checked.data === true })
    }

    const form = await request.formData()
    const manifestFile = form.get('manifest')
    const sheet = form.get('sheet')
    if (!(manifestFile instanceof File) || !(sheet instanceof File)) {
      return json({ error: 'Envie o pet.json e a spritesheet.' }, 400)
    }
    if (manifestFile.size > MAX_MANIFEST || sheet.size > MAX_SHEET) {
      return json({ error: 'O pet ultrapassa o limite de 8 MB.' }, 413)
    }
    if (!IMAGE_TYPES.has(sheet.type)) {
      return json({ error: 'A imagem deve ser PNG, WebP ou GIF.' }, 400)
    }

    const petName = clean(String(form.get('petName') ?? ''), '', 80)
    if (!petName) return json({ error: 'Informe o nome do seu pet.' }, 400)
    const checked = await supabase.rpc('community_pet_name_available', { candidate: petName })
    if (checked.error) throw checked.error
    if (checked.data !== true) return json({ error: 'Já existe um pet com esse nome.' }, 409)

    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const fingerprintBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${forwarded}:${new Date().toISOString().slice(0, 10)}`),
    )
    const fingerprint = [...new Uint8Array(fingerprintBytes)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const slot = await supabase.rpc('consume_community_submission_slot', {
      request_fingerprint: fingerprint,
    })
    if (slot.error) throw slot.error
    if (slot.data !== true) return json({ error: 'Limite de 10 envios por dia atingido.' }, 429)

    const manifestText = await manifestFile.text()
    const manifest = JSON.parse(manifestText) as Record<string, unknown>
    manifest.displayName = petName

    const id = crypto.randomUUID()
    const slug = `${slugify(String(manifest.id ?? petName))}-${id.slice(0, 8)}`
    const extension = sheet.type === 'image/png' ? 'png' : sheet.type === 'image/gif' ? 'gif' : 'webp'
    const manifestPath = `${id}/pet.json`
    const sheetPath = `${id}/spritesheet.${extension}`
    const authorName = clean(String(form.get('authorName') ?? ''), 'Anônimo', 60)
    manifest.spritesheetPath = `spritesheet.${extension}`
    const storedManifest = JSON.stringify(manifest)
    const bucket = supabase.storage.from('community-pets')
    const manifestUpload = await bucket.upload(manifestPath, storedManifest, {
      contentType: 'application/json',
      upsert: false,
    })
    if (manifestUpload.error) throw manifestUpload.error

    const sheetUpload = await bucket.upload(sheetPath, sheet, { contentType: sheet.type, upsert: false })
    if (sheetUpload.error) {
      await bucket.remove([manifestPath])
      throw sheetUpload.error
    }

    const inserted = await supabase.from('community_pets').insert({
      id,
      slug,
      display_name: petName,
      description: typeof manifest.description === 'string' ? manifest.description.slice(0, 500) : null,
      author_name: authorName,
      manifest_path: manifestPath,
      sheet_path: sheetPath,
    })
    if (inserted.error) {
      await bucket.remove([manifestPath, sheetPath])
      if (inserted.error.code === '23505') {
        return json({ error: 'Já existe um pet com esse nome.' }, 409)
      }
      throw inserted.error
    }

    return json({ id, status: 'pending' }, 201)
  } catch (error) {
    console.error(error)
    return json({ error: 'Não foi possível receber o pet.' }, 500)
  }
})
