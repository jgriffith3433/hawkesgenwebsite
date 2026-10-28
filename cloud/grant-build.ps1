# One-time: lets Cloud Build build the portal's functions in both projects. New Google Cloud projects build with the
# default compute service account, which starts without these roles ("missing permission on the build service account").
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$projects = @{ 'hawkes-staging' = '388576319982'; 'hawkes-prod' = '598611630218' }
$roles = 'roles/cloudbuild.builds.builder', 'roles/artifactregistry.writer', 'roles/logging.logWriter', 'roles/storage.objectViewer'
foreach ($p in $projects.Keys) {
  $sa = "serviceAccount:$($projects[$p])-compute@developer.gserviceaccount.com"
  foreach ($r in $roles) {
    & $g projects add-iam-policy-binding $p --member=$sa --role=$r --condition=None --quiet 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "$p $r ok" -ForegroundColor Green } else { Write-Host "$p $r FAILED" -ForegroundColor Red }
  }
}
