using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
class SetupLauncher {
 static int Main() {
  string temp=Path.Combine(Path.GetTempPath(),"SegretarioMMG-"+Guid.NewGuid().ToString("N"));
  try {
   Directory.CreateDirectory(temp);
   string zip=Path.Combine(temp,"package.zip");
   using(var source=Assembly.GetExecutingAssembly().GetManifestResourceStream("package.zip"))
   using(var dest=File.Create(zip)) { source.CopyTo(dest); }
   ZipFile.ExtractToDirectory(zip,Path.Combine(temp,"setup"));
   string root=Path.Combine(temp,"setup");
   var start=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(root,"Setup.ps1")+"\" -PackageRoot \""+root+"\"");
   start.UseShellExecute=false;
   using(var process=Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
  } catch(Exception e) { Console.Error.WriteLine(e.Message); Console.ReadLine(); return 1; }
  finally { if(Directory.Exists(temp)) Directory.Delete(temp,true); }
 }
}
