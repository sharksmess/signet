# Cree le depot GitHub du projet et pose les protections. A lancer UNE fois,
# par l'humain, depuis la racine du projet, sur la branche main :
#   C:\dev\saas-factory\scripts\github-setup.ps1 -Name signet -Visibility public
# Aucun jeton n'est ecrit dans un fichier : gh range l'authentification dans
# le gestionnaire d'identifiants de Windows.
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [ValidateSet("private","public")][string]$Visibility = "private",
  # Reposer uniquement la protection de main et les alertes, sans recreer le depot.
  [switch]$ProtectOnly
)
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "ECHEC: $m" -ForegroundColor Red; exit 1 }

Step "Pre-requis"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI absent : winget install GitHub.cli, rouvre le terminal, puis gh auth login." }
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "gh non authentifie : lance 'gh auth login' (GitHub.com, HTTPS, navigateur)." }
# Seuls les fichiers suivis comptent : un fichier non suivi (ex. .env.test.local)
# ne part jamais sur GitHub, un push ne transmet que des commits.
if (-not $ProtectOnly) {
if (git status --porcelain --untracked-files=no) { Fail "modifications non committees sur des fichiers suivis : committe d'abord." }
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

} else { $owner = gh api user -q .login; Ok "connecte en tant que $owner (protection seule)" }

Step "Reglages de fusion : squash uniquement, message = titre + description de la PR"
gh repo edit "$owner/$Name" --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge | Out-Null
# Le commit de squash reprend la description de la PR : preuves, verdicts,
# decisions et trailer "Slice: NNN" restent dans l'historique de main.
gh api -X PATCH "repos/$owner/$Name" -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Ok "fait" } else { Warn "reglage du message de squash refuse : a faire dans Settings > General > Pull Requests" }

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
$tmp = [IO.Path]::GetTempFileName()
# Ecriture sans BOM : Set-Content -Encoding UTF8 de PowerShell 5 en ajoute un,
# que l'API GitHub rejette comme JSON invalide.
[IO.File]::WriteAllText($tmp, $ruleset, (New-Object System.Text.UTF8Encoding($false)))
# Filtre en PowerShell : PowerShell 5 retire les guillemets doubles des
# arguments passes a gh, ce qui casserait une expression jq.
$existing = $null
$list = gh api "repos/$owner/$Name/rulesets" 2>$null
if ($LASTEXITCODE -eq 0 -and $list) { $existing = (($list | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq "main-protegee" } | Select-Object -First 1).id }
if ($existing) {
  $out = gh api -X PUT "repos/$owner/$Name/rulesets/$existing" --input $tmp 2>&1
} else {
  $out = gh api -X POST "repos/$owner/$Name/rulesets" --input $tmp 2>&1
}
$rc = $LASTEXITCODE
Remove-Item $tmp
if ($rc -eq 0) { Ok "main protegee : PR obligatoire, CI 'ci' verte, historique lineaire, pas de force-push ni de suppression." }
else {
  Warn "protection refusee par GitHub. Reponse exacte :"
  $out | ForEach-Object { Warn "  $_" }
  if ($Visibility -eq "private") { Warn "Sur un compte gratuit, les regles ne s'appliquent qu'aux depots publics (ou avec GitHub Pro)." }
  Warn "Tant que ce n'est pas regle, seuls les hooks locaux protegent main."
}

Step "Alertes de securite des dependances"
gh api -X PUT "repos/$owner/$Name/vulnerability-alerts" 2>$null | Out-Null
gh api -X PUT "repos/$owner/$Name/automated-security-fixes" 2>$null | Out-Null
Ok "alertes et correctifs automatiques Dependabot demandes"

Write-Host "`nDepot pret : https://github.com/$owner/$Name" -ForegroundColor Green
Write-Host "Chaque tranche : branche slice/NNN-nom -> close-slice.sh -> ship-slice.sh -> CI -> ta fusion." -ForegroundColor Green
