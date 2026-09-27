# Cree le depot GitHub du projet et pose les protections. A lancer UNE fois,
# par l'humain, depuis la racine du projet :
#   .\scripts\github-setup.ps1 -Name signet
# Aucun jeton n'est ecrit dans un fichier : gh range l'authentification dans
# le gestionnaire d'identifiants de Windows.
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [ValidateSet("private","public")][string]$Visibility = "private"
)
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "ECHEC: $m" -ForegroundColor Red; exit 1 }

Step "Pre-requis"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI absent : winget install GitHub.cli, rouvre le terminal, puis gh auth login." }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "gh non authentifie : lance 'gh auth login' (GitHub.com, HTTPS, navigateur)." }
if (git status --porcelain) { Fail "arbre de travail non propre : committe d'abord." }
if ((git symbolic-ref --short HEAD) -ne "main") { Fail "place-toi sur main pour la creation initiale." }
$owner = gh api user -q .login
Ok "connecte en tant que $owner"

Step "Creation du depot $owner/$Name ($Visibility)"
if (git remote get-url origin 2>$null) { Warn "remote origin deja defini, creation sautee." }
else {
  gh repo create "$owner/$Name" --$Visibility --source . --remote origin
  if ($LASTEXITCODE -ne 0) { Fail "creation du depot impossible." }
}
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail "push initial de main impossible." }
Ok "main pousse"

Step "Reglages de fusion : squash uniquement, branche supprimee apres fusion"
gh repo edit "$owner/$Name" --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge | Out-Null
Ok "fait"

Step "Protection de main (regle serveur : la seule qui ne depend pas de la discipline locale)"
$ruleset = @'
{
  "name": "main-protegee",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "ci" } ] } }
  ]
}
'@
$tmp = New-TemporaryFile
Set-Content $tmp $ruleset -Encoding UTF8
gh api -X POST "repos/$owner/$Name/rulesets" --input $tmp 2>&1 | Out-Null
$rc = $LASTEXITCODE
Remove-Item $tmp
if ($rc -eq 0) { Ok "main protegee : PR obligatoire, CI 'ci' verte, historique lineaire, pas de force-push ni de suppression." }
else {
  Warn "protection refusee par GitHub. Sur un compte gratuit, les regles de protection ne s'appliquent"
  Warn "qu'aux depots publics : passe le depot en public, ou en GitHub Pro, puis relance ce script."
  Warn "En attendant, seuls les hooks locaux protegent main - c'est une protection de discipline, pas de serveur."
}

Step "Alertes de securite des dependances"
gh api -X PUT "repos/$owner/$Name/vulnerability-alerts" 2>$null | Out-Null
gh api -X PUT "repos/$owner/$Name/automated-security-fixes" 2>$null | Out-Null
Ok "alertes et correctifs automatiques Dependabot demandes"

Write-Host "`nDepot pret : https://github.com/$owner/$Name" -ForegroundColor Green
Write-Host "Chaque tranche : branche slice/NNN-nom -> close-slice.sh -> ship-slice.sh -> CI -> ta fusion." -ForegroundColor Green
