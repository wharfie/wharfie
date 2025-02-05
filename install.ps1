param(
    [string]$Version
)

$appName = "wharfie"
$repo = "wharfie/wharfie"

# If no version provided, get the latest from GitHub
if (-not $Version) {
    Write-Output "Determining the latest version from GitHub..."
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "PowerShell" }
        $Version = $release.tag_name
    }
    catch {
        Write-Error "Failed to determine the latest version. $_"
        exit 1
    }
}

Write-Output "Installing $appName version: $Version"

# Use Windows as the OS constant
$os = "windows"

# Detect architecture
switch ($env:PROCESSOR_ARCHITECTURE.ToLower()) {
    "amd64" { $arch = "x64" }
    "arm64"   { $arch = "arm64" }
    default   {
        Write-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE"
        exit 1
    }
}

# Construct the download URL
$downloadUrl = "https://github.com/$repo/releases/download/$Version/$appName-$os-$arch.exe"
Write-Output "Downloading $appName from $downloadUrl..."

# Create a temporary file
$tempFile = New-TemporaryFile

# Download the binary
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile.FullName -UseBasicParsing
}
catch {
    Write-Error "Failed to download the binary. $_"
    exit 1
}

# Define the installation directory.
# This example installs into "C:\Program Files\wharfie". Administrative rights are required.
$installDir = "$env:ProgramFiles\wharfie"
if (-not (Test-Path $installDir)) {
    try {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    catch {
        Write-Error "Failed to create installation directory. $_"
        exit 1
    }
}

$destination = Join-Path $installDir "$appName.exe"
Write-Output "Placing $appName in $installDir..."
try {
    Move-Item -Path $tempFile.FullName -Destination $destination -Force
}
catch {
    Write-Error "Failed to move the binary. $_"
    exit 1
}

Write-Output "$appName installed successfully!"