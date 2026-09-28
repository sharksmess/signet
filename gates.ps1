# Gates humains - equivalent Windows du Makefile.
# Usage :  .\gates.ps1 approve-prd
#          .\gates.ps1 approve-architecture
#          .\gates.ps1 status
#
# Ces commandes t'appartiennent. Les agents en sont exclus par
# block-dangerous.sh : ils ne peuvent ni les lancer ni ecrire dans .gates\.

param([Parameter(Position=0)][string]$Action = "status")

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
