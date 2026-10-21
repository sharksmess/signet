# Verifie (et complete sur demande) un fichier d'environnement local contre son
# modele versionne, SANS JAMAIS AFFICHER UNE VALEUR (usine 1.6).
# Issu du 15/10/2026 sur Signet : six allers-retours pour des lignes inversees,
# des mots de passe vides et une variable perdue, faute d'outil de controle.
#
# Usage, depuis la racine du projet :
#   .\scripts\env-check.ps1                       # .env.test.local contre .env.test.example
#   .\scripts\env-check.ps1 -Fill                 # et complete ce qui manque
#   .\scripts\env-check.ps1 -Local .env -Example .env.example
#
# -Fill : une variable absente dont la valeur du modele est inventee (sans
# MOT_DE_PASSE ni autre etiquette) est recopiee telle quelle ; sinon la valeur
# est demandee en saisie masquee. Les fichiers locaux restent ignores par git.
param(
  [string]$Local = ".env.test.local",
  [string]$Example = ".env.test.example",
  [switch]$Fill
)
$ErrorActionPreference = "Stop"
$placeholder = 'MOT_DE_PASSE|ANCIEN_MDP|NOUVEAU_MDP|NOM_BASE|A_REMPLIR|CHANGE_ME|<[^>]+>'
function Parse($path) {
  $map = [ordered]@{}; $dups = @()
  foreach ($l in [IO.File]::ReadAllLines((Join-Path (Get-Location) $path))) {
    if ($l -match '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') {
      if ($map.Contains($Matches[1])) { $dups += $Matches[1] }
      $map[$Matches[1]] = $Matches[2]
    }
  }
  return @{ Map = $map; Dups = $dups }
}
if (-not (Test-Path $Example)) { Write-Host "ECHEC: modele $Example absent." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Local)) {
  if (-not $Fill) { Write-Host "ECHEC: $Local absent. Relance avec -Fill pour le creer." -ForegroundColor Red; exit 1 }
  [IO.File]::WriteAllText((Join-Path (Get-Location) $Local), "", (New-Object Text.UTF8Encoding($false)))
}
$ex = Parse $Example; $lo = Parse $Local
# Une variable vide dans le modele est facultative (usine 1.6.3) : ni exigee, ni signalee vide.
$optional = @($ex.Map.Keys | Where-Object { -not $ex.Map[$_].Trim() })
$missing = @($ex.Map.Keys | Where-Object { -not $lo.Map.Contains($_) -and $optional -notcontains $_ })

if ($Fill -and $missing.Count -gt 0) {
  $add = New-Object System.Text.StringBuilder
  foreach ($n in $missing) {
    $v = $ex.Map[$n].Trim()
    if ($v -and $v -notmatch $placeholder) { [void]$add.Append("$n=$v`n"); Write-Host "  +  $n (valeur inventee du modele)" -ForegroundColor Green }
    else {
      $s = Read-Host "Valeur pour $n (saisie masquee, rien ne s'affiche)" -AsSecureString
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
      if (-not $plain) { Write-Host "  -- $n laissee vide" -ForegroundColor Yellow; continue }
      if ($v -match $placeholder) { $plain = ($v -replace $placeholder, $plain) }  # le modele donne la forme (URL), la saisie le secret
      [void]$add.Append("$n=$plain`n"); Remove-Variable plain
      Write-Host "  +  $n (saisie)" -ForegroundColor Green
    }
  }
  $full = Join-Path (Get-Location) $Local
  $raw = [IO.File]::ReadAllText($full)
  $prefix = if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { "`r`n" } else { "" }
  [IO.File]::AppendAllText($full, $prefix + $add.ToString(), (New-Object Text.UTF8Encoding($false)))
  $lo = Parse $Local
  $missing = @($ex.Map.Keys | Where-Object { -not $lo.Map.Contains($_) -and $optional -notcontains $_ })
}

$problems = 0
function Report($title, $names) {
  if ($names.Count -gt 0) {
    Write-Host $title -ForegroundColor Red
    $names | ForEach-Object { Write-Host "   $_" }
    $script:problems += $names.Count
  }
}
Report "Variables du modele absentes de $Local :" $missing
Report "Variables vides :" @($lo.Map.Keys | Where-Object { -not $lo.Map[$_].Trim() -and $optional -notcontains $_ })
Report "Etiquette a remplacer encore presente :" @($lo.Map.Keys | Where-Object { $lo.Map[$_] -match $placeholder })
Report "URL Postgres sans mot de passe :" @($lo.Map.Keys | Where-Object { $lo.Map[$_] -match '^\s*postgres(ql)?://[^:/@]+(:)?@' })
Report "Variables en double :" @($lo.Dups)
$extra = @($lo.Map.Keys | Where-Object { -not $ex.Map.Contains($_) })
if ($extra.Count -gt 0) { Write-Host "Variables absentes du modele (a verifier, peut-etre une faute de nom) :" -ForegroundColor Yellow; $extra | ForEach-Object { Write-Host "   $_" } }

# Pour chaque URL, l'utilisateur seulement (jamais le mot de passe).
$urls = @($lo.Map.Keys | Where-Object { $lo.Map[$_] -match '^\s*postgres(ql)?://' })
if ($urls.Count -gt 0) {
  Write-Host "Connexions (variable -> utilisateur) :" -ForegroundColor Cyan
  foreach ($n in $urls) { if ($lo.Map[$n] -match '://([^:@/]+)') { Write-Host "   $n -> $($Matches[1])" } }
}
if ($problems -eq 0) { Write-Host "OK : $Local est complet ($($lo.Map.Count) variables), aucune valeur affichee." -ForegroundColor Green; exit 0 }
Write-Host "A CORRIGER : $problems point(s). Relance avec -Fill pour completer ce qui manque." -ForegroundColor Red
exit 1
