# One-time per project: the roles the portal's functions need on the default compute service account. New Google Cloud
# projects give that account nothing, so Cloud Build can't build ("missing permission on the build service account") and
# the functions can't reach Firestore ("PERMISSION_DENIED"). Safe to run again.
#   build:   cloudbuild.builds.builder, artifactregistry.writer, logging.logWriter, storage.objectViewer
#   running: datastore.user (Firestore), firebaseauth.admin (sign-in sessions), iam.serviceAccountTokenCreator
#            (signing), eventarc.eventReceiver + run.invoker (the assistant's Firestore trigger)
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$projects = @{ 'hawkes-staging' = '388576319982'; 'hawkes-prod' = '598611630218' }
$roles = 'roles/cloudbuild.builds.builder', 'roles/artifactregistry.writer', 'roles/logging.logWriter', 'roles/storage.objectViewer',
         'roles/datastore.user', 'roles/firebaseauth.admin', 'roles/iam.serviceAccountTokenCreator', 'roles/eventarc.eventReceiver', 'roles/run.invoker'
foreach ($p in $projects.Keys) {
  $sa = "serviceAccount:$($projects[$p])-compute@developer.gserviceaccount.com"
  foreach ($r in $roles) {
    & $g projects add-iam-policy-binding $p --member=$sa --role=$r --condition=None --quiet 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "$p $r ok" -ForegroundColor Green } else { Write-Host "$p $r FAILED" -ForegroundColor Red }
  }
}
