using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Drawing;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Diagnostics;
class SetupLauncher : Form {
 readonly Label phase=new Label(), detail=new Label(), pulse=new Label();
 readonly ProgressBar bar=new ProgressBar();
 readonly Button close=new Button();
 readonly Stopwatch elapsed=Stopwatch.StartNew();
 readonly Timer timer=new Timer();
 readonly string temp=Path.Combine(Path.GetTempPath(),"SegretarioMMG-"+Guid.NewGuid().ToString("N"));
 volatile bool finished; int result=1, tick; string failure="";
 SetupLauncher() {
  Text="Segretario MMG - Installazione"; ClientSize=new Size(690,390); StartPosition=FormStartPosition.CenterScreen;
  Font=new Font("Segoe UI",11); BackColor=Color.FromArgb(245,247,251); FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false;
  Label title=new Label {Text="Prepariamo il tuo assistente",Location=new Point(30,28),Size=new Size(630,42),Font=new Font("Segoe UI",21,FontStyle.Bold),ForeColor=Color.FromArgb(26,49,73)};
  phase.Text="Preparazione dei file...";phase.SetBounds(32,94,625,35);phase.Font=new Font("Segoe UI",13,FontStyle.Bold);
  detail.Text="Tra poco potrai scegliere il modello IA.";detail.SetBounds(32,142,625,65);
  bar.SetBounds(32,220,625,19);bar.Style=ProgressBarStyle.Marquee;
  pulse.SetBounds(32,254,625,48);pulse.ForeColor=Color.FromArgb(65,85,106);pulse.Font=new Font("Segoe UI",9);
  Label note=new Label {Text="Mantieni Chrome chiuso. I download possono richiedere anche un'ora o piu.",Location=new Point(32,310),Size=new Size(480,55),Font=new Font("Segoe UI",9)};
  close.Text="Chiudi";close.SetBounds(550,320,105,36);close.Enabled=false;close.Click+=(s,e)=>Close();
  Controls.AddRange(new Control[]{title,phase,detail,bar,pulse,note,close});
  FormClosing+=(s,e)=>{if(!finished){e.Cancel=true;MessageBox.Show(this,"Installazione in corso. Attendi il termine; puoi minimizzare questa finestra.","Segretario MMG");}};
  timer.Interval=250;timer.Tick+=(s,e)=>RefreshProgress();
  Shown+=(s,e)=>{timer.Start();Task.Run((Action)RunSetup);};
 }
 void RunSetup() {
  try {
   Directory.CreateDirectory(temp);
   string zip=Path.Combine(temp,"package.zip");
   using(var source=Assembly.GetExecutingAssembly().GetManifestResourceStream("package.zip"))
   using(var dest=File.Create(zip)) { source.CopyTo(dest); }
   ZipFile.ExtractToDirectory(zip,Path.Combine(temp,"setup"));
   string root=Path.Combine(temp,"setup");
   var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),@"WindowsPowerShell\v1.0\powershell.exe"),"-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(root,"Setup.ps1")+"\" -PackageRoot \""+root+"\" -ProgressFile \""+Path.Combine(temp,"progress.json")+"\"");
   start.UseShellExecute=false;start.CreateNoWindow=true;start.WindowStyle=ProcessWindowStyle.Hidden;
   using(var process=Process.Start(start)) { process.WaitForExit(); result=process.ExitCode; }
  } catch(Exception e) { failure=e.Message;result=1; }
  finally { try{if(Directory.Exists(temp)) Directory.Delete(temp,true);}catch{} finished=true; }
 }
 void RefreshProgress() {
  if(finished){
   timer.Stop();bar.Style=ProgressBarStyle.Blocks;bar.Value=result==0?100:0;
   phase.Text=result==0?"Installazione completata":result==3?"Installazione annullata":"Installazione non completata";
   detail.Text=result==0?"Segui le istruzioni aperte in Chrome per aggiungere l'estensione.":result==3?"Hai annullato la procedura. Puoi riaprire il setup quando preferisci.":"Puoi riprovare con il setup. Log: %LOCALAPPDATA%\\SegretarioMMG\\setup.log\n"+failure;
   pulse.Text="Tempo trascorso: "+elapsed.Elapsed.ToString(@"hh\:mm\:ss");close.Enabled=true;return;
  }
  try {
   var d=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(temp,"progress.json")));
   phase.Text=Convert.ToString(d["stage"]);detail.Text=Convert.ToString(d["detail"]);
   int percent=Convert.ToInt32(d["percent"]);
   bar.Style=percent<0?ProgressBarStyle.Marquee:ProgressBarStyle.Blocks;
   if(percent>=0)bar.Value=Math.Max(0,Math.Min(100,percent));
  }catch(IOException){}catch(ArgumentException){}catch(KeyNotFoundException){}
  string[] frames={"|","/","-","\\"};
  pulse.Text=frames[(tick++)%4]+"  Procedura in corso - Tempo trascorso: "+elapsed.Elapsed.ToString(@"hh\:mm\:ss")+"\nLa barra indica la fase corrente; durante le attese resta animata.";
 }
 [STAThread] static int Main(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var f=new SetupLauncher()){Application.Run(f);return f.result;}}
}
