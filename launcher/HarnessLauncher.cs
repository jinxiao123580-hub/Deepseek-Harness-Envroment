using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;

/// <summary>
/// DeepSeek Harness 一键启动器（跨用户/跨机器版本）：
/// 双击运行 —— 若 Web 端口未监听则后台无窗口启动 dsh web，
/// 等待服务就绪后自动打开浏览器访问对应地址。
///
/// 本版本不再写死用户名/路径，全部改为「自动探测 + 环境变量可覆盖」：
///   - DSH_WEB_PORT      Web 端口（默认 3080）
///   - DSH_WORKDIR       dsh 工作目录（默认：脚本所在目录，其次 D:\Deepseek Harness）
///   - DSH_NODE          node.exe 路径（默认：自动探测 / 回退 PATH 上的 node）
///   - DSH_HTTP_PROXY    本地代理地址（如 http://127.0.0.1:7897；不设则自动探测 7897）
/// </summary>
class HarnessLauncher
{
    private static int Port = 3080;
    private static string Url { get { return "http://127.0.0.1:" + Port; } }

    const string ProxyCandidate = "http://127.0.0.1:7897";

    static int ReadPort()
    {
        string v = Environment.GetEnvironmentVariable("DSH_WEB_PORT");
        int p;
        if (!string.IsNullOrEmpty(v) && int.TryParse(v, out p) && p > 0 && p < 65536)
            return p;
        return 3080;
    }

    static bool IsListening(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                return result.AsyncWaitHandle.WaitOne(300);
            }
        }
        catch
        {
            return false;
        }
    }

    static string PickWorkingDirectory()
    {
        string env = Environment.GetEnvironmentVariable("DSH_WORKDIR");
        if (!string.IsNullOrEmpty(env) && Directory.Exists(env)) return env;

        string here = Path.GetDirectoryName(
            System.Reflection.Assembly.GetExecutingAssembly().Location);
        if (!string.IsNullOrEmpty(here) && Directory.Exists(here)) return here;

        string preferred = @"D:\Deepseek Harness";
        if (Directory.Exists(preferred)) return preferred;

        return string.IsNullOrEmpty(here) ? "." : here;
    }

    static string FindNode()
    {
        string env = Environment.GetEnvironmentVariable("DSH_NODE");
        if (!string.IsNullOrEmpty(env) && File.Exists(env)) return env;

        // 常见安装位置
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return c;

        return "node"; // 回退 PATH
    }

    static string FindDshBin()
    {
        // 用 npm 全局根 + 已知包相对路径推测
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("npm", "root -g");
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            Process p = Process.Start(psi);
            if (p != null)
            {
                string root = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit(5000);
                if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
                {
                    string bin = Path.Combine(root, "@deepseek-ai", "dsh", "lib", "bin.js");
                    if (File.Exists(bin)) return bin;
                }
            }
        }
        catch
        {
        }

        // 回退：写入时常见本机路径（仅作兜底提醒）
        return @"%USERPROFILE%\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js";
    }

    static string PickProxy()
    {
        string env = Environment.GetEnvironmentVariable("DSH_HTTP_PROXY");
        if (!string.IsNullOrEmpty(env)) return env;
        // 若 7897 在监听则默认使用（本机常用代理端口）
        if (IsListening(7897)) return ProxyCandidate;
        return null;
    }

    static void StartServer(string workDir)
    {
        string node = FindNode();
        string bin = Environment.ExpandEnvironmentVariables(FindDshBin());
        bool hasBin = File.Exists(bin);
        string proxy = PickProxy();

        if (hasBin)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + bin + "\" web --no-open");
                psi.WorkingDirectory = workDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                if (!string.IsNullOrEmpty(proxy))
                {
                    psi.EnvironmentVariables["HTTPS_PROXY"] = proxy;
                    psi.EnvironmentVariables["HTTP_PROXY"] = proxy;
                }
                // Node 24：让内置 fetch 通过环境变量代理
                psi.EnvironmentVariables["NODE_OPTIONS"] = "--use-env-proxy";
                Process.Start(psi);
                return;
            }
            catch
            {
                // 落到 dsh 命令回退
            }
        }
        else
        {
            Console.WriteLine("[launcher] 未找到 dsh bin.js，回退到 `dsh web`（需要 dsh 在 PATH）");
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("dsh", "web");
            psi.WorkingDirectory = workDir;
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Minimized;
            Process.Start(psi);
        }
        catch
        {
        }
    }

    [STAThread]
    static void Main(string[] args)
    {
        Port = ReadPort();
        string workDir = PickWorkingDirectory();

        Console.WriteLine("[launcher] web = " + Url + "  workdir = " + workDir);

        if (!IsListening(Port))
        {
            StartServer(workDir);
        }

        // 等待服务就绪，最多约 90 秒
        for (int i = 0; i < 180 && !IsListening(Port); i++)
        {
            Thread.Sleep(500);
        }

        // 打开浏览器
        try
        {
            Process.Start(Url);
        }
        catch
        {
        }
    }
}
