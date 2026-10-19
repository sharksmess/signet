# Gates humains - equivalent Windows du Makefile.
# Usage :  .\gates.ps1 approve-prd
#          .\gates.ps1 approve-architecture
#          .\gates.ps1 status
#          .\gates.ps1 scope-add "apps/web/src/x.ts"   (usine 1.6)
#          .\gates.ps1 reopen-slice 002                (usine 1.6)
#
# Ces commandes t'appartiennent. Les agents en sont exclus par
# block-dangerous.sh : ils ne peuvent ni les lancer ni ecrire dans .gates\.

param([Parameter(Position=0)][string]$Action = "status", [Parameter(Position=1)][string]$Arg = "")

# Ecriture sans BOM et en fin de ligne LF : gate-check.sh lit ces fichiers ligne a ligne.
function Write-Lf($path, $text, [switch]$Append) {
  $full = Join-Path (Get-Location) $path
  $enc = New-Object Text.UTF8Encoding($false)
  if ($Append) { [IO.File]::AppendAllText($full, $text, $enc) } else { [IO.File]::WriteAllText($full, $text, $enc) }
}

function Fail($m) { Write-Host "ECHEC: $m" -ForegroundColor Red; exit 1 }
function Ok($m)   { Write-Host $m -ForegroundColor Green }

New-Item -ItemType Directory -Force -Path ".gates" | Out-Null

switch ($Action) {

  "approve-prd" {
    if (-not (Test-Path "docs\01-product\PRD.md")) { Fail "PRD absent." }
    Write-Host "As-tu LU le PRD en entier ? Ce gate engage tout ce qui suit." -ForegroundColor Yellow
    if ((Read-Host "Tape OUI pour approuver") -ne "OUI") { Fail "Approbation annulee." }
    New-Item -ItemType File -Force -Path ".gates\01-prd.approved" | Out-Null
    Ok "Gate 1 approuve. Phase 2 ouverte : /saas-factory:architect"
  }

  "approve-architecture" {
    if (-not (Test-Path ".gates\01-prd.approved"))     { Fail "Approuve le PRD d'abord." }
    if (-not (Test-Path "docs\02-architecture\ERD.md")) { Fail "ERD absent." }
    if (-not (Test-Path "docs\02-architecture\ADR"))    { Fail "Aucun ADR." }
    Write-Host "Ce gate GELE stack.json et ouvre l'ecriture de code." -ForegroundColor Yellow
    if ((Read-Host "Tape OUI pour approuver") -ne "OUI") { Fail "Approbation annulee." }
    New-Item -ItemType File -Force -Path ".gates\02-architecture.approved" | Out-Null
    $s = Get-Content "stack.json" -Raw | ConvertFrom-Json
    $s.frozenAt = (Get-Date -Format "yyyy-MM-dd")
    $s | ConvertTo-Json -Depth 10 | Set-Content "stack.json"
    Ok "Gate 2 approuve. Socle gele. Phase 3 ouverte : /saas-factory:slice"
  }

  "approve-hardening" {
    New-Item -ItemType File -Force -Path ".gates\04-hardening.approved" | Out-Null
    Ok "Gate 4 approuve."
  }

  "approve-release" {
    if (-not (Test-Path ".gates\\04-hardening.approved")) { Fail "Approuve le durcissement d'abord." }
    Write-Host "Mise en service. Sauvegardes testees ? RLS verifiee avec deux tenants ?" -ForegroundColor Yellow
    if ((Read-Host "Tape OUI pour approuver") -ne "OUI") { Fail "Approbation annulee." }
    New-Item -ItemType File -Force -Path ".gates\\release.approved" | Out-Null
    Ok "Release approuvee. Lance /retro pendant que les frictions sont fraiches."
  }

  "reopen-architecture" {
    Remove-Item ".gates\02-architecture.approved" -ErrorAction SilentlyContinue
    Ok "Gate 2 rouvert. Ecris un ADR expliquant pourquoi avant de reprendre."
  }

  "scope-add" {
    # Elargit le perimetre de la tranche active. Geste humain : l'agent s'arrete
    # et demande, l'humain decide, l'agent inscrit la decision au registre.
    if (-not (Test-Path ".gates\current-slice")) { Fail "aucune tranche active." }
    if (-not $Arg) { Fail "usage : .\gates.ps1 scope-add <motif>   (ex. apps/web/src/instrumentation.ts)" }
    if ($Arg -match '^\*|^\.\*$|^/') { Fail "motif trop large ou absolu : '$Arg'." }
    $slice = (Get-Content ".gates\current-slice" -Raw).Trim()
    $scope = ".gates\scope-$slice.txt"
    if (-not (Test-Path $scope)) { Fail "$scope absent." }
    $lines = Get-Content $scope | ForEach-Object { $_.Trim() }
    if ($lines -contains $Arg) { Ok "deja present dans $scope : $Arg"; break }
    $raw = [IO.File]::ReadAllText((Join-Path (Get-Location) $scope))
    $prefix = if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { "`n" } else { "" }
    Write-Lf $scope ($prefix + $Arg + "`n") -Append
    Ok "Ajoute au perimetre de la tranche $slice : $Arg"
    Write-Host "Dis a l'agent pourquoi : il committe ce changement et l'inscrit au registre." -ForegroundColor Yellow
  }

  "reopen-slice" {
    # Rouvre une tranche close (CI rouge apres cloture, fiche a refaire). La
    # cloture suivante refait toutes les preuves et un nouveau commit de cloture.
    if (Test-Path ".gates\current-slice") { Fail "une tranche est deja active : $((Get-Content '.gates\current-slice' -Raw).Trim())." }
    if ($Arg -notmatch '^\d{3}$') { Fail "usage : .\gates.ps1 reopen-slice <NNN>   (ex. 002)" }
    if (-not (Test-Path ".gates\slice-$Arg.closed")) { Fail "la tranche $Arg n'est pas close." }
    Write-Lf ".gates\current-slice" "$Arg`n"
    Ok "Tranche $Arg rouverte. Dis a l'agent pourquoi : il l'inscrit au registre, corrige, puis relance scripts/close-slice.sh."
  }

  "status" {
    Write-Host "`n=== Gates franchis ===" -ForegroundColor Cyan
    if (Test-Path ".gates\*") { Get-ChildItem ".gates" | Select-Object -ExpandProperty Name }
    else { Write-Host "aucun" }
    Write-Host "`n=== Tranche active ===" -ForegroundColor Cyan
    if (Test-Path ".gates\current-slice") { Get-Content ".gates\current-slice" }
    else { Write-Host "aucune" }
  }

  default { Fail "Action inconnue : $Action" }
}
