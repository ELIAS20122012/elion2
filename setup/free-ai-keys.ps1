# Elion: free AI keys (Groq, Cerebras, OpenRouter, Mistral) -> config\secrets.json ("free": {...}).
# Keys are typed hidden, stored only on this PC, and tested once. Empty input = keep / skip.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'config\secrets.json'
$apis = @(
  @{ n='groq';       l='Groq';       url='https://console.groq.com/keys';          base='https://api.groq.com/openai/v1' },
  @{ n='cerebras';   l='Cerebras';   url='https://cloud.cerebras.ai';              base='https://api.cerebras.ai/v1' },
  @{ n='openrouter'; l='OpenRouter'; url='https://openrouter.ai/keys';             base='https://openrouter.ai/api/v1' },
  @{ n='mistral';    l='Mistral';    url='https://console.mistral.ai/api-keys';    base='https://api.mistral.ai/v1' }
)
$s = @{}
if (Test-Path $file) {
  $raw = (Get-Content $file -Raw -Encoding UTF8).TrimStart([char]0xFEFF)
  if ($raw.Trim()) { $obj = $raw | ConvertFrom-Json; foreach ($p in $obj.PSObject.Properties) { $s[$p.Name] = $p.Value } }
}
$free = @{}
if ($s.ContainsKey('free') -and $s['free']) { foreach ($p in $s['free'].PSObject.Properties) { $free[$p.Name] = $p.Value } }

Write-Host ''
Write-Host '  Elion - free AI keys' -ForegroundColor Cyan
Write-Host '  For each one: open the link, sign in, create a key, copy it, paste here (it stays hidden).'
Write-Host '  Just press Enter to skip one.'
foreach ($a in $apis) {
  Write-Host ''
  $have = if ($free.ContainsKey($a.n)) { ' (already saved - Enter keeps it)' } else { '' }
  Write-Host ("  {0}: {1}{2}" -f $a.l, $a.url, $have) -ForegroundColor Yellow
  $open = Read-Host '  Open this page in the browser now? (y/n)'
  if ($open -match '^[yY]') { Start-Process $a.url }
  $sec = Read-Host ("  Paste the {0} key" -f $a.l) -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
  if (-not $key) { continue }
  try {
    $r = Invoke-RestMethod "$($a.base)/models" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 20
    Write-Host ("  OK - {0} models available - saved" -f @($r.data).Count) -ForegroundColor Green
    $free[$a.n] = $key
    $s['free'] = $free
    New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
    [IO.File]::WriteAllText($file, ($s | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
  } catch {
    Write-Host ("  This key did not work ({0}). Not saved - run again to retry." -f $_.Exception.Message) -ForegroundColor Red
  }
}
$s['free'] = $free
New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
[IO.File]::WriteAllText($file, ($s | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host ("  Saved: {0}" -f (($free.Keys | Sort-Object) -join ', ')) -ForegroundColor Cyan
Write-Host '  Elion uses them automatically from its next start (restart: Telegram /restart).'
Write-Host ''
