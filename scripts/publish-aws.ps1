param(
  [string]$Profile = 'planb-deploy',
  [string]$Region = 'ap-south-1',
  [string]$Aws = 'aws'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Invoke-AwsJson([string[]]$Arguments) {
  $result = & $Aws @Arguments --profile $Profile --region $Region --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw "AWS command failed: $($Arguments[0..1] -join ' ')" }
  return ($result | ConvertFrom-Json)
}
$hosting = (Invoke-AwsJson @('cloudformation', 'describe-stacks', '--stack-name', 'planb-live-hosting')).Stacks[0].Outputs
$backend = (Invoke-AwsJson @('cloudformation', 'describe-stacks', '--stack-name', 'planb-live-backend')).Stacks[0].Outputs
function Output-Value($Items, $Key) { return ($Items | Where-Object OutputKey -eq $Key).OutputValue }
if ((Test-Path infra/auth/planb-logo.png) -and (Test-Path infra/auth/cognito.css)) {
  $null = Invoke-AwsJson @('cognito-idp', 'set-ui-customization', '--user-pool-id', (Output-Value $backend 'UserPoolId'), '--client-id', (Output-Value $backend 'AuthClientId'), '--image-file', 'fileb://infra/auth/planb-logo.png', '--css', 'file://infra/auth/cognito.css')
}
$settings = @(
  "VITE_API_BASE_URL=$(Output-Value $backend 'ApiUrl')",
  "VITE_AUTH_AUTHORITY=$(Output-Value $backend 'AuthAuthority')",
  "VITE_AUTH_CLIENT_ID=$(Output-Value $backend 'AuthClientId')",
  "VITE_AUTH_DOMAIN=$(Output-Value $backend 'AuthDomain')"
)
if ($settings | Where-Object { $_ -match '=$' }) { throw 'Missing stack outputs.' }
$settings | Set-Content .env.production -Encoding utf8
# Only update these public connection settings; preserve other local settings.
$existing = if (Test-Path .env.local) { Get-Content .env.local | Where-Object { $_ -notmatch '^VITE_(API_BASE_URL|AUTH_AUTHORITY|AUTH_CLIENT_ID|AUTH_DOMAIN)=' } } else { @() }
@($existing) + $settings | Set-Content .env.local -Encoding utf8
& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
New-Item -ItemType Directory -Force .aws-sam | Out-Null
Compress-Archive -Path dist/* -DestinationPath .aws-sam/frontend.zip -Force
$appId = Output-Value $hosting 'AppId'
$deployment = Invoke-AwsJson @('amplify', 'create-deployment', '--app-id', $appId, '--branch-name', 'main')
Invoke-WebRequest -Uri $deployment.zipUploadUrl -Method Put -InFile .aws-sam/frontend.zip -ContentType 'application/zip' | Out-Null
$job = Invoke-AwsJson @('amplify', 'start-deployment', '--app-id', $appId, '--branch-name', 'main', '--job-id', $deployment.jobId)
Write-Output "Deployment started: $($job.jobSummary.jobId)"
Write-Output "Website: $(Output-Value $hosting 'Origin')"
