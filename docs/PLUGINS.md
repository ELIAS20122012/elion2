# Plugins and skills

Everything outside the kernel is a plugin. Built-ins: `core` (tasks:open), `google` (Gmail/Calendar),
`briefing` (/brief), `skills` (skills/*.md).

## Skill = Markdown file (no code)

`elias skill new <name>` → edit `skills/<name>.md` → restart (`stop-elias.cmd` / autostart).
It appears in Telegram as `/<name>` and in `elias skill list`.

```
---
name: mail                      # a-z 0-9 _
description: ایمیل‌های مهم       # shown in the Telegram menu
capabilities: read:email        # checked by the permission policy
context: gmail:recent           # data appended to the prompt
verify: contains:📧             # non_empty | contains:X | regex:X | json:k1,k2 | none
provider: auto                  # optional
timeout: 300                    # seconds, optional
---
Prompt… {{input}} = text after the command
```

## Plugin = code (TypeScript)

`plugins/<name>/index.ts`, default export `Plugin { name, version, description, setup(ctx) }`.
`ctx.kernel` → `registerSkill`, `registerCommand` (instant reply, no AI), `registerContextSource`, `registerProvider`, `log`.
`ctx.options` = `config.plugins.options.<name>`. Template: `plugins/_example` (folders starting with `_` are ignored).
Plugins are trusted local code; side effects (`publish:*`, `send:*`, `trade:execute`) still go through approvals.

Config: `"plugins": { "disabled": ["google"], "options": { "example": { "style": "funny" } } }`
Check: `elias plugins`.
