param(
    [ValidateSet('Update','Import')][string]$Mode='Update',
    [string]$Source,
    [switch]$NoPublish
)
$ErrorActionPreference='Stop'
$repoPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location -LiteralPath $repoPath
if($Mode -eq 'Import' -and -not $Source){
    Add-Type -AssemblyName System.Windows.Forms
    $choice=New-Object Windows.Forms.Form
    $choice.Text='BRO - Publish market data'
    $choice.Size=New-Object Drawing.Size(480,160)
    $choice.StartPosition='CenterScreen'
    $choice.FormBorderStyle='FixedDialog'
    $choice.MaximizeBox=$false
    $choice.MinimizeBox=$false
    $label=New-Object Windows.Forms.Label
    $label.Text='Select data to validate and publish to the website:'
    $label.Location=New-Object Drawing.Point(20,18)
    $label.AutoSize=$true
    $choice.Controls.Add($label)
    $merged=New-Object Windows.Forms.Button
    $merged.Text='Merged CSV'
    $merged.Location=New-Object Drawing.Point(20,62)
    $merged.Size=New-Object Drawing.Size(190,34)
    $merged.Add_Click({$choice.Tag='merged';$choice.Close()})
    $choice.Controls.Add($merged)
    $folder=New-Object Windows.Forms.Button
    $folder.Text='Per-stock CSV folder'
    $folder.Location=New-Object Drawing.Point(232,62)
    $folder.Size=New-Object Drawing.Size(210,34)
    $folder.Add_Click({$choice.Tag='directory';$choice.Close()})
    $choice.Controls.Add($folder)
    [void]$choice.ShowDialog()
    if(-not $choice.Tag){exit 0}
    if($choice.Tag -eq 'merged'){
        $picker=New-Object Windows.Forms.OpenFileDialog
        $picker.Filter='CSV files (*.csv)|*.csv'
        $picker.Title='Select merged CSV to publish'
        if($picker.ShowDialog() -ne 'OK'){exit 0}
        $Source=$picker.FileName
    }else{
        $picker=New-Object Windows.Forms.FolderBrowserDialog
        $picker.Description='Select the folder containing per-stock CSV files to publish'
        if($picker.ShowDialog() -ne 'OK'){exit 0}
        $Source=$picker.SelectedPath
    }
}
$candidates=[Collections.Generic.List[string]]::new()
if($env:MARKET_ATLAS_PYTHON){$candidates.Add($env:MARKET_ATLAS_PYTHON)}
$candidates.Add((Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'))
Get-Command python.exe -All -ErrorAction SilentlyContinue | ForEach-Object {if($_.Source -notlike '*WindowsApps*'){$candidates.Add($_.Source)}}
$chosen=$null
foreach($candidate in $candidates){
    if(-not(Test-Path -LiteralPath $candidate)){continue}
    try{& $candidate -c 'import numpy,pandas' 2>$null;if($LASTEXITCODE -eq 0){$chosen=$candidate;break}}catch{}
}
if(-not $chosen){throw 'Python with numpy and pandas was not found. Set MARKET_ATLAS_PYTHON to your Python executable.'}
$arguments=@((Join-Path $PSScriptRoot 'update.py'))
if($Source){$arguments+=@('--source',$Source)}
if(-not $NoPublish){$arguments+='--publish'}
& $chosen @arguments
exit $LASTEXITCODE
