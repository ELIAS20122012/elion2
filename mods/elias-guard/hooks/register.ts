import type { Register } from 'claude-code'

/** Files that hold Elias's keys and tokens — no agent may read, print, copy or edit them. */
export const SECRET = /(secrets\.json|google-token\.json|google-client\.json|(^|[\\/\s"'])\.env(\.|\b|$)|\.cloudflared[\\/]|cert\.pem|tunnel[-_]?token)/i
/** Code edits that must be followed by `npm test`. */
const CODE = /elias-os[\\/].*\.(ts|tsx|py)$|trading-robot[\\/].*\.(ts|tsx|py)$/i

const touched = (e: unknown): string => {
  try {
    return JSON.stringify(e)
  } catch {
    return ''
  }
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.ui.status('🛡 elias-guard')
    return next(e)
  })

  // 1) hard block: any tool call whose input names a secret file
  on('tool.call', ($, e, next) => {
    const s = touched(e)
    if (SECRET.test(s) && !/\.example/i.test(s)) {
      $.ui.toast('🛡 blocked: secret file')
      return { deny: `${$.plugin.name}: secret files (secrets.json, google tokens, .env, .cloudflared) are off-limits for agents — Elias edits them himself.` }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` }))

  // 2) after a code edit: remind to run the tests before finishing
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && CODE.test(e.file_path)) $.ui.status('🛡 code changed — run npm test before finishing')
    return r
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && CODE.test(e.file_path)) $.ui.status('🛡 code changed — run npm test before finishing')
    return r
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (/npm (run )?test|pytest/.test(e.command) && r.deny === undefined) $.ui.status(r.isError ? '🛡 tests FAILED' : '🛡 tests passed ✓')
    return r
  })
}
