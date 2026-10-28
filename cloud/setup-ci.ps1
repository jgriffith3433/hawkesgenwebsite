# One-time: lets GitHub Actions (.github/workflows/firebase.yml) deploy the portal without any stored key. In each project:
# a Workload Identity pool that trusts GitHub's OIDC tokens from jgriffith3433/hawkesgenwebsite only (beta for staging,
# main for live), and a `deployer` service account with just what `firebase deploy` needs. Safe to run again.
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$repo = 'jgriffith3433/hawkesgenwebsite'
$projects = @(
  @{ id = 'hawkes-staging'; number = '388576319982'; branch = 'refs/heads/beta' },
  @{ id = 'hawkes-prod'; number = '598611630218'; branch = 'refs/heads/main' }
)
$roles = 'roles/firebasehosting.admin', 'roles/cloudfunctions.admin', 'roles/run.admin', 'roles/artifactregistry.admin',
         'roles/cloudscheduler.admin', 'roles/eventarc.admin', 'roles/secretmanager.admin', 'roles/datastore.indexAdmin',
         'roles/firebaserules.admin', 'roles/serviceusage.serviceUsageConsumer', 'roles/cloudbuild.builds.editor', 'roles/firebase.viewer'
function Ok($what) { if ($LASTEXITCODE -eq 0) { Write-Host "  ok  $what" -ForegroundColor Green } else { Write-Host "  --  $what (exists or failed)" -ForegroundColor Yellow } }
foreach ($p in $projects) {
  Write-Host "== $($p.id)" -ForegroundColor Cyan
  & $g iam workload-identity-pools create github --location=global --display-name="GitHub Actions" --project $p.id 2>$null | Out-Null; Ok 'pool github'
  & $g iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github --project $p.id `
    --issuer-uri=https://token.actions.githubusercontent.com `
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" `
    --attribute-condition="assertion.repository=='$repo' && assertion.ref=='$($p.branch)'" 2>$null | Out-Null; Ok "provider github ($repo, $($p.branch))"
  & $g iam service-accounts create deployer --display-name="GitHub deploys (firebase.yml)" --project $p.id 2>$null | Out-Null; Ok 'service account deployer'
  $sa = "deployer@$($p.id).iam.gserviceaccount.com"
  foreach ($r in $roles) { & $g projects add-iam-policy-binding $p.id --member="serviceAccount:$sa" --role=$r --condition=None --quiet 2>$null | Out-Null; Ok $r }
  # The functions run as the default compute account: the deployer may act as it.
  & $g iam service-accounts add-iam-policy-binding "$($p.number)-compute@developer.gserviceaccount.com" --member="serviceAccount:$sa" --role=roles/iam.serviceAccountUser --project $p.id --quiet 2>$null | Out-Null; Ok 'act as the functions account'
  & $g iam service-accounts add-iam-policy-binding $sa --role=roles/iam.workloadIdentityUser --project $p.id --quiet `
    --member="principalSet://iam.googleapis.com/projects/$($p.number)/locations/global/workloadIdentityPools/github/attribute.repository/$repo" 2>$null | Out-Null; Ok 'GitHub may be the deployer'
}
