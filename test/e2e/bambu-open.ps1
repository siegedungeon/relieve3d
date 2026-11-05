param([string]$Project)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$p = Start-Process 'C:\Program Files\Bambu Studio\bambu-studio.exe' -ArgumentList ('"' + $Project + '"') -PassThru
try {
  $title = [IO.Path]::GetFileNameWithoutExtension($Project)
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $p.Refresh()
    if ($p.HasExited) { throw "Bambu exited: $($p.ExitCode)" }
    $handle = $p.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { continue }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770'))
    foreach ($dialog in $dialogs) {
      if ($dialog.Current.Name -eq 'Bambu Studio error') { throw 'Bambu GUI rejected the exported project.' }
    }
    if ($p.MainWindowTitle.Contains($title)) { Write-Output 'GUI_VALID'; return }
  }
  throw "Bambu GUI timeout: $($p.MainWindowTitle)"
} finally { if (!$p.HasExited) { Stop-Process -Id $p.Id } }
