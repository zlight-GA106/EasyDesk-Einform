param(
    [string]$Sdk = $env:ANDROID_SDK_ROOT,
    [string]$Jdk = $env:JAVA_HOME,
    [string]$BuildTools = '35.0.0',
    [switch]$WithChecks
)
$ErrorActionPreference = 'Stop'
if (!$Sdk) { $Sdk = 'D:\Android\Sdk' }
if (!$Jdk) { throw 'Set JAVA_HOME or pass -Jdk (JDK 17).' }
$project = $PSScriptRoot
$androidJar = Join-Path $Sdk 'platforms\android-19\android.jar'
$toolDir = Join-Path $Sdk "build-tools\$BuildTools"
$java = Join-Path $Jdk 'bin\java.exe'
$javac = Join-Path $Jdk 'bin\javac.exe'
foreach ($file in @($androidJar, $java, $javac, (Join-Path $toolDir 'aapt.exe'))) {
    if (!(Test-Path -LiteralPath $file)) { throw "Required tool missing: $file" }
}
function Run([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed ($LASTEXITCODE)" }
}
$work = Join-Path $project ('build\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$classes = Join-Path $work 'classes'
$generated = Join-Path $work 'generated'
$dex = Join-Path $work 'dex'
$dist = Join-Path $project 'dist'
$signing = Join-Path $project 'signing'
New-Item -ItemType Directory -Force -Path $classes,$generated,$dex,$dist,$signing | Out-Null
$key = Join-Path $signing 'z9-mvp.jks'
if (!(Test-Path -LiteralPath $key)) {
    Run (Join-Path $Jdk 'bin\keytool.exe') @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android','-alias','einform-mvp','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=EasyDesk Einform MVP, O=EasySmart','-storetype','JKS')
}
function CompileApk([string]$Manifest, [string[]]$Sources, [string]$Output, [string]$ExtraClassPath) {
    $unsigned = Join-Path $work ([IO.Path]::GetFileNameWithoutExtension($Output) + '-unsigned.apk')
    $aligned = Join-Path $work ([IO.Path]::GetFileNameWithoutExtension($Output) + '-aligned.apk')
    Run (Join-Path $toolDir 'aapt.exe') @('package','-f','-m','-J',$generated,'-M',$Manifest,'-S',(Join-Path $project 'res'),'-I',$androidJar,'-F',$unsigned)
    $allSources = @($Sources) + @(Get-ChildItem -LiteralPath $generated -Recurse -Filter '*.java' | ForEach-Object FullName)
    $arguments = @('-encoding','UTF-8','-source','7','-target','7','-Xlint:-options','-bootclasspath',$androidJar,'-d',$classes)
    if ($ExtraClassPath) { $arguments += @('-classpath',$ExtraClassPath) }
    Run $javac ($arguments + $allSources)
    $compiled = @(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object FullName)
    Run $java (@('-cp',(Join-Path $toolDir 'lib\d8.jar'),'com.android.tools.r8.D8','--min-api','19','--lib',$androidJar,'--output',$dex) + $compiled)
    Push-Location $dex
    try { Run (Join-Path $toolDir 'aapt.exe') @('add',$unsigned,'classes.dex') } finally { Pop-Location }
    Run (Join-Path $toolDir 'zipalign.exe') @('-f','4',$unsigned,$aligned)
    Run $java @('-jar',(Join-Path $toolDir 'lib\apksigner.jar'),'sign','--ks',$key,'--ks-key-alias','einform-mvp','--ks-pass','pass:android','--key-pass','pass:android','--min-sdk-version','19','--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','false','--v4-signing-enabled','false','--out',$Output,$aligned)
    Run $java @('-jar',(Join-Path $toolDir 'lib\apksigner.jar'),'verify','--verbose','--min-sdk-version','19',$Output)
    Run (Join-Path $toolDir 'aapt.exe') @('dump','badging',$Output)
    Get-FileHash -LiteralPath $Output -Algorithm SHA256 | Format-List
}
$sources = @(Get-ChildItem -LiteralPath (Join-Path $project 'src') -Recurse -Filter '*.java' | ForEach-Object FullName)
$apk = Join-Path $dist 'EasyDesk-Einform-Z9.apk'
CompileApk (Join-Path $project 'AndroidManifest.xml') $sources $apk ''
if ($WithChecks) {
    $mainClasses = $classes
    $classes = Join-Path $work 'check-classes'; $dex = Join-Path $work 'check-dex'; $generated = Join-Path $work 'check-generated'
    New-Item -ItemType Directory -Force -Path $classes,$dex,$generated | Out-Null
    $checkSources = @(Get-ChildItem -LiteralPath (Join-Path $project 'checks\android') -Recurse -Filter '*.java' | ForEach-Object FullName)
    CompileApk (Join-Path $project 'checks\AndroidManifest.xml') $checkSources (Join-Path $dist 'Einform-Checks.apk') $mainClasses
}
Write-Host "APK ready: $apk"
