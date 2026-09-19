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

    /// <summary>
    /// 端口是否真的在监听。
    ///
    /// 【2026-09-19 修】旧实现是 `BeginConnect(...)` + `WaitOne(300)` 直接 return，
    /// **从不调用 EndConnect**。于是返回值实际是"这次异步连接操作在 300ms 内结束了吗"，
    /// 而不是"有人在这个端口监听吗" —— 连接**被拒绝**同样会让操作结束。
    ///
    /// 本机实测（.NET Framework 4.0.30319，两个探针端口对照）：
    ///   · 监听中的端口 → WaitOne(300) 立刻 True（正确）
    ///   · 已关闭的端口 → WaitOne(300) 为 False，但**再等 3 秒就变 True**，之后 EndConnect 抛
    ///     SocketException。也就是说失败路径的异步完成**比 300ms 慢**。
    /// 结论：在本机上旧实现碰巧给出正确答案（纯粹因为 300ms 短于失败完成延迟），
    /// 属于**潜伏缺陷**而非已发生故障；一旦某个环境下 RST 回得快于 300ms，
    /// `IsListening` 就会对死端口返回 true，后果是 Main 里永远不启动 dsh、
    /// PickProxy 里给子进程设一个指向死端口的 HTTP(S)_PROXY。
    ///
    /// 修法是改用文档规定的模式：等到句柄置位后再 EndConnect（被拒时它会抛）。
    /// 这样语义与超时无关，不再依赖"失败够不够慢"。
    /// </summary>
    static bool IsListening(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(300)) return false; // 超时 = 没在监听
                client.EndConnect(result);                              // 被拒会抛 → 下面 catch
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 解析 dsh 的工作目录。
    ///
    /// 【2026-09-19 修】旧顺序是 env → **exe 所在目录** → D:\Deepseek Harness。
    /// 而 launcher/README.md 教用户把 exe 复制到桌面 → exe 目录就是桌面 → 桌面被当成
    /// dsh 工作目录（会话 slug、相对路径全落在桌面上）。
    /// 新顺序：显式覆盖 → 旁置的 dsh-workdir.txt → D:\Deepseek Harness → 非桌面的 exe 目录 → 用户主目录。
    /// </summary>
    static string PickWorkingDirectory()
    {
        string env = Environment.GetEnvironmentVariable("DSH_WORKDIR");
        if (!string.IsNullOrEmpty(env) && Directory.Exists(env)) return env;

        string here = Path.GetDirectoryName(
            System.Reflection.Assembly.GetExecutingAssembly().Location);

        // 允许在 exe 旁边放一个 dsh-workdir.txt 指定工作目录（一行路径）
        if (!string.IsNullOrEmpty(here))
        {
            try
            {
                string sidecar = Path.Combine(here, "dsh-workdir.txt");
                if (File.Exists(sidecar))
                {
                    string want = File.ReadAllText(sidecar).Trim();
                    if (!string.IsNullOrEmpty(want) && Directory.Exists(want)) return want;
                }
            }
            catch { }
        }

        string preferred = @"D:\Deepseek Harness";
        if (Directory.Exists(preferred)) return preferred;

        // 只有当 exe 不在桌面时才用 exe 目录
        if (!string.IsNullOrEmpty(here) && Directory.Exists(here))
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            bool isDesktop = !string.IsNullOrEmpty(desktop) &&
                             string.Equals(here.TrimEnd('\\'), desktop.TrimEnd('\\'),
                                           StringComparison.OrdinalIgnoreCase);
            if (!isDesktop) return here;
            Console.WriteLine("[launcher] exe 位于桌面，不作为工作目录；改用用户主目录");
        }

        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    /// <summary>
    /// 取 node 主版本号（失败返回 0）。
    /// 用途：`--use-env-proxy` 是 Node 24+ 才认的参数，老版本会直接
    /// `node: bad option: --use-env-proxy` 并让子进程立刻退出。
    /// </summary>
    static int NodeMajorVersion(string node)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, "--version");
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            Process p = Process.Start(psi);
            if (p == null) return 0;
            string v = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(3000);
            if (v.StartsWith("v")) v = v.Substring(1);
            int dot = v.IndexOf('.');
            int major;
            if (dot > 0 && int.TryParse(v.Substring(0, dot), out major)) return major;
        }
        catch { }
        return 0;
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
                // Node 24：让内置 fetch 通过环境变量代理。
                // 【2026-09-19 修】旧实现无条件设 NODE_OPTIONS=--use-env-proxy，
                // 在 Node < 24 上子进程会直接 `bad option` 退出（dsh 永远起不来）。
                // 这里按主版本号门控；未识别到版本时宁可不设。
                if (!string.IsNullOrEmpty(proxy))
                {
                    int major = NodeMajorVersion(node);
                    if (major >= 24)
                    {
                        psi.EnvironmentVariables["NODE_OPTIONS"] = "--use-env-proxy";
                    }
                    else if (major > 0)
                    {
                        Console.WriteLine("[launcher] node v" + major + " < 24，跳过 NODE_OPTIONS=--use-env-proxy");
                    }
                }
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
            ProcessStartInfo psi = new ProcessStartInfo("dsh", "web --no-open");
            psi.WorkingDirectory = workDir;
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Minimized;
            Process.Start(psi);
        }
        catch
        {
            Console.WriteLine("[launcher] 启动 `dsh web` 失败 —— 确认 dsh 已在 PATH（重开终端后重试）");
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
        else
        {
            Console.WriteLine("[launcher] 端口已在监听，直接打开浏览器");
        }

        // 等待服务就绪，最多约 90 秒
        bool ready = IsListening(Port);
        for (int i = 0; i < 180 && !ready; i++)
        {
            Thread.Sleep(500);
            ready = IsListening(Port);
        }

        if (!ready)
        {
            Console.WriteLine("[launcher] 等待 90 秒后 " + Url + " 仍未就绪，" +
                              "不打开浏览器（避免看到白屏）。请检查 dsh 是否能手动启动。");
            return;
        }

        // 打开浏览器
        try
        {
            Process.Start(Url);
        }
        catch
        {
            Console.WriteLine("[launcher] 打开浏览器失败，请手动访问 " + Url);
        }
    }
}
