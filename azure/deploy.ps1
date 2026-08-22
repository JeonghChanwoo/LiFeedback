[CmdletBinding()]
param(
  [string]$ResourceGroup = $env:AZURE_RESOURCE_GROUP,
  [string]$AppName = $env:AZURE_APP_NAME,
  [string]$Location = $env:AZURE_LOCATION,
  [string]$SubscriptionId = $env:AZURE_SUBSCRIPTION_ID,
  [string]$AllowedOrigins = $env:AZURE_ALLOWED_ORIGINS
)

$ErrorActionPreference = 'Stop'

if (-not $ResourceGroup -or -not $AppName -or -not $Location) {
  throw 'Set AZURE_RESOURCE_GROUP, AZURE_APP_NAME, and AZURE_LOCATION before deployment.'
}
$githubToken = $env:GITHUB_TOKEN
if (-not $githubToken) { $githubToken = $env:GH_TOKEN }
if (-not $githubToken) {
  throw 'Set GITHUB_TOKEN in the current shell. The value is read but never written to a file.'
}
if (-not $AllowedOrigins) { $AllowedOrigins = "https://$AppName.azurewebsites.net" }

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw 'Azure subscription selection failed.' }
}
az account show --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Azure CLI is not logged in or the subscription is unavailable.' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
  az webapp up `
    --name $AppName `
    --resource-group $ResourceGroup `
    --location $Location `
    --runtime 'NODE:22-lts' `
    --sku B1 `
    --os-type Linux `
    --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw 'App Service creation or source deployment failed.' }
}
finally {
  Pop-Location
}

az webapp config set `
  --resource-group $ResourceGroup `
  --name $AppName `
  --startup-file 'npm start' `
  --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'App Service startup configuration failed.' }

# Do not echo this command or its output: it contains the secret token.
az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $AppName `
  --settings `
    "GITHUB_TOKEN=$githubToken" `
    "NODE_ENV=production" `
    "ALLOW_NULL_ORIGIN=false" `
    "ALLOWED_ORIGINS=$AllowedOrigins" `
    "PORT=8080" `
  --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'App Service application settings update failed.' }

Write-Output "Deployment completed for https://$AppName.azurewebsites.net"
Write-Output "Health: https://$AppName.azurewebsites.net/health"
Write-Output "Readiness: https://$AppName.azurewebsites.net/ready"
