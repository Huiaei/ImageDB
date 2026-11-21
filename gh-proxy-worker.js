'use strict'

/**
 * GitHub 加速下载 · Cloudflare Worker（单文件）
 * 基于 hunshcn/gh-proxy 二次开发，由 AI 修改维护。
 * 版本记录见页面底部「更新日志」卡（本文件头部不再重复记录）。
 */

/* ==========================================================================
 * 配置区（部署时通常只改这里，下面的代码不用动）
 * ========================================================================== */

// 版本号：页面顶部徽标显示它。发版只改这一处，再去页面「更新日志」卡补一条（唯一记录处）
const VERSION = 'v1.6'

// 路由前缀：自定义路由为 example.com/gh/* 时改成 '/gh/'（少一个杠都会错）
const PREFIX = '/'

// 白名单：请求路径里包含其中之一才放行；空数组 = 全部放行
const whiteList = []   // 例：['/username/']

// 功能开关与个性化设置
const Config = {
    // 分支文件改用 jsDelivr 镜像：0 = 关闭（默认），1 = 开启
    jsdelivr: 0,

    // 访问令牌（可选，防滥用）。留空 '' = 关闭鉴权，行为与原来完全一致。
    // 设为非空字符串后，所有代理请求必须携带下面三者之一：
    //   1) 查询参数 ?token=该值（首次命中会种下 Cookie，之后的 302 跳转无需重复带参）
    //   2) 请求头 x-proxy-token: 该值（不会转发给 GitHub）
    //   3) Cookie ghproxy_token，值 = 该值（浏览器自动携带）
    auth: '',

    // 本版源码地址：填 Gist 或自己仓库的 http(s) 链接，页脚就渲染「查看源码」。
    // 留空 '' = 页脚不渲染源码链接（默认）；非 http(s) 的值会被忽略。
    sourceUrl: '',

    // —— 高级项（一般不用改）——
    // 查最新发行版用的 GitHub API 基地址（需要自建反代时改这里）
    githubApi: 'https://api.github.com',
    // 访问 GitHub API 时的 User-Agent
    userAgent: 'gh-proxy-worker',
    // 令牌命中后种下的 Cookie 有效期（秒），默认 30 天
    cookieMaxAge: 2592000
}

// 备查：原版用于拉取 hunshcn.github.io 上的静态资源（404.html / sw.js / conf.js）。
// 现前端已内联进 INDEX_HTML，本变量不再使用，仅保留注释。
// const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/'

// 自定义前端页面（内联 HTML，访问根路径时返回）
const INDEX_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GitHub 加速下载</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#f8fafc;
    --card:#ffffff;
    --border:#e2e8f0;
    --text:#0f172a;
    --text-muted:#64748b;
    --primary:#2563eb;
    --primary-hover:#1d4ed8;
    --success:#059669;
    --error:#dc2626;
    --radius:12px;
    --shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
    --shadow-lg:0 10px 25px rgba(0,0,0,.08);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#0f172a;
      --card:#1e293b;
      --border:#334155;
      --text:#f1f5f9;
      --text-muted:#94a3b8;
      --shadow:0 1px 3px rgba(0,0,0,.3);
      --shadow-lg:0 10px 25px rgba(0,0,0,.4);
    }
  }
  html{font-size:16px}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--bg);
    color:var(--text);
    min-height:100vh;
    display:flex;
    flex-direction:column;
    line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }

  /* 顶部导航 */
  header{
    padding:20px 24px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    max-width:720px;
    width:100%;
    margin:0 auto;
  }
  .logo{
    display:flex;
    align-items:center;
    gap:10px;
    font-weight:700;
    font-size:1.1rem;
  }
  .logo-icon{
    width:32px;height:32px;
    background:var(--primary);
    border-radius:8px;
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:800;font-size:.9rem;
  }
  .badge{
    font-size:.7rem;
    padding:2px 8px;
    border-radius:999px;
    background:var(--border);
    color:var(--text-muted);
    font-weight:500;
  }

  /* 主内容 */
  main{
    flex:1;
    width:100%;
    max-width:720px;
    margin:0 auto;
    padding:0 24px 60px;
  }
  .hero{
    text-align:center;
    padding:40px 0 32px;
  }
  .hero h1{
    font-size:1.75rem;
    font-weight:800;
    letter-spacing:-.02em;
    margin-bottom:8px;
  }
  .hero p{
    color:var(--text-muted);
    font-size:.95rem;
  }

  /* 输入卡片 */
  .card{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:var(--radius);
    box-shadow:var(--shadow);
    padding:24px;
    margin-bottom:20px;
  }
  .input-group{
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .input-label{
    font-size:.85rem;
    font-weight:600;
    color:var(--text-muted);
  }
  .url-input{
    width:100%;
    padding:14px 16px;
    font-size:.95rem;
    font-family:inherit;
    background:var(--bg);
    border:1.5px solid var(--border);
    border-radius:10px;
    color:var(--text);
    outline:none;
    transition:border-color .15s,box-shadow .15s;
  }
  .url-input:focus{
    border-color:var(--primary);
    box-shadow:0 0 0 3px rgba(37,99,235,.12);
  }
  .url-input::placeholder{color:var(--text-muted);opacity:.7}

  .btn-row{
    display:flex;
    gap:10px;
    flex-wrap:wrap;
  }
  .btn{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    padding:11px 20px;
    font-size:.9rem;
    font-weight:600;
    font-family:inherit;
    border:none;
    border-radius:10px;
    cursor:pointer;
    transition:all .15s;
    text-decoration:none;
  }
  .btn-primary{
    background:var(--primary);
    color:#fff;
  }
  .btn-primary:hover{background:var(--primary-hover)}
  .btn-primary:disabled{
    opacity:.5;
    cursor:not-allowed;
  }
  .btn-secondary{
    background:transparent;
    color:var(--text);
    border:1.5px solid var(--border);
  }
  .btn-secondary:hover{background:var(--bg)}
  .btn svg{width:16px;height:16px;fill:currentColor}

  /* 状态提示 */
  .status{
    display:flex;
    align-items:center;
    gap:8px;
    padding:10px 14px;
    border-radius:8px;
    font-size:.85rem;
    margin-top:12px;
    display:none;
  }
  .status.show{display:flex}
  .status-error{
    background:rgba(220,38,38,.08);
    color:var(--error);
    border:1px solid rgba(220,38,38,.2);
  }
  .status-success{
    background:rgba(5,150,105,.08);
    color:var(--success);
    border:1px solid rgba(5,150,105,.2);
  }

  /* 结果区 */
  .result-card{
    display:none;
  }
  .result-card.show{display:block;animation:fadeUp .3s ease}
  @keyframes fadeUp{
    from{opacity:0;transform:translateY(8px)}
    to{opacity:1;transform:translateY(0)}
  }
  .result-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    margin-bottom:14px;
  }
  .result-title{
    font-size:.9rem;
    font-weight:700;
    display:flex;
    align-items:center;
    gap:8px;
  }
  .result-title .dot{
    width:8px;height:8px;
    background:var(--success);
    border-radius:50%;
  }
  .result-url{
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    padding:12px 14px;
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.82rem;
    word-break:break-all;
    color:var(--text);
    margin-bottom:14px;
    line-height:1.5;
  }
  .result-actions{
    display:flex;
    gap:10px;
    flex-wrap:wrap;
  }

  /* 支持类型说明 */
  .info-card h3{
    font-size:.9rem;
    font-weight:700;
    margin-bottom:12px;
  }
  .type-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:8px;
  }
  @media(max-width:480px){.type-grid{grid-template-columns:1fr}}
  .type-item{
    display:flex;
    align-items:center;
    gap:8px;
    padding:8px 12px;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    font-size:.8rem;
    color:var(--text-muted);
  }
  .type-item code{
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.75rem;
    color:var(--text);
  }

  /* 页脚 */
  footer{
    text-align:center;
    padding:24px;
    font-size:.8rem;
    color:var(--text-muted);
    border-top:1px solid var(--border);
  }
  footer a{color:var(--primary);text-decoration:none}

  /* 代理地址设置 */
  .settings-toggle{
    background:none;
    border:none;
    color:var(--text-muted);
    cursor:pointer;
    font-size:.8rem;
    font-family:inherit;
    display:flex;
    align-items:center;
    gap:4px;
    padding:4px 8px;
    border-radius:6px;
  }
  .settings-toggle:hover{background:var(--bg);color:var(--text)}
  .settings-panel{
    display:none;
    margin-top:12px;
    padding-top:12px;
    border-top:1px dashed var(--border);
  }
  .settings-panel.show{display:block}
  .settings-panel label{
    font-size:.8rem;
    color:var(--text-muted);
    display:block;
    margin-bottom:6px;
  }
  .settings-panel input{
    width:100%;
    padding:10px 12px;
    font-size:.85rem;
    font-family:"SF Mono",Monaco,Consolas,monospace;
    background:var(--bg);
    border:1.5px solid var(--border);
    border-radius:8px;
    color:var(--text);
    outline:none;
  }
  .settings-panel input:focus{border-color:var(--primary)}

  /* 更多下载方式 */
  .more-toggle{
    margin-top:14px;
    padding-top:14px;
    border-top:1px dashed var(--border);
    display:flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    background:none;
    border-left:none;
    border-right:none;
    border-bottom:none;
    color:var(--text-muted);
    cursor:pointer;
    font-size:.85rem;
    font-family:inherit;
    width:100%;
    transition:color .15s;
  }
  .more-toggle:hover{color:var(--text)}
  .more-toggle .arrow{transition:transform .2s;flex-shrink:0}
  .more-toggle.open .arrow{transform:rotate(180deg)}
  .more-panel{
    display:none;
    margin-top:14px;
  }
  .more-panel.show{display:block;animation:fadeUp .25s ease}
  .more-group{margin-bottom:16px}
  .more-group:last-child{margin-bottom:0}
  .more-group-label{
    font-size:.72rem;
    font-weight:700;
    color:var(--text-muted);
    text-transform:uppercase;
    letter-spacing:.06em;
    margin-bottom:8px;
  }
  .chip-row{
    display:flex;
    flex-wrap:wrap;
    gap:8px;
  }
  .chip{
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding:8px 14px;
    font-size:.82rem;
    font-weight:500;
    font-family:inherit;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    color:var(--text);
    cursor:pointer;
    transition:all .15s;
  }
  .chip:hover{
    border-color:var(--primary);
    color:var(--primary);
    background:rgba(37,99,235,.05);
  }
  .chip svg{width:14px;height:14px;fill:currentColor;flex-shrink:0}
  .chip.copied{
    border-color:var(--success);
    color:var(--success);
    background:rgba(5,150,105,.06);
  }

  /* 进阶用法 */
  .adv-row{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    padding:8px 12px;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    margin-bottom:8px;
  }
  .adv-row code{
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    word-break:break-all;
    color:var(--text);
  }
  .mini-chip{padding:4px 10px;font-size:.72rem;border-radius:6px;flex-shrink:0}
  .adv-label{
    font-size:.78rem;
    font-weight:700;
    color:var(--text-muted);
    margin:0 0 6px;
  }
  .adv-label+.adv-label{margin-top:16px}
  .adv-note{
    font-size:.75rem;
    color:var(--text-muted);
    line-height:1.7;
    margin:0 0 10px;
  }
  .adv-note code,
  .adv-label code{
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    color:var(--text);
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:4px;
    padding:0 4px;
  }
  .adv-pre{
    margin:0 0 10px;
    padding:12px 14px;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    line-height:1.65;
    color:var(--text);
    overflow-x:auto;
  }

  /* 顶部来源提示 */
  .notice{
    display:flex;
    align-items:center;
    justify-content:center;
    flex-wrap:wrap;
    gap:6px;
    margin:0 0 2px;
    padding:8px 14px;
    font-size:.76rem;
    color:var(--text-muted);
    background:rgba(37,99,235,.06);
    border:1px solid rgba(37,99,235,.18);
    border-radius:999px;
    text-align:center;
  }
  .notice a{color:var(--primary);text-decoration:none;font-weight:600}
  .notice a:hover{text-decoration:underline}
  .notice b{color:var(--text);font-weight:700}
  .notice .ver{
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    padding:1px 7px;
    border-radius:999px;
    background:var(--card);
    border:1px solid var(--border);
    color:var(--text);
  }

  /* 提示词卡 */
  .prompt-head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    flex-wrap:wrap;
  }
  .prompt-head h3{margin:0}
  .prompt-box{margin-top:10px}
  .prompt-box summary{
    cursor:pointer;
    list-style:none;
    font-size:.8rem;
    font-weight:600;
    color:var(--text-muted);
    padding:9px 12px;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    transition:color .15s,border-color .15s;
  }
  .prompt-box summary:hover{color:var(--primary);border-color:var(--primary)}
  .prompt-box summary::-webkit-details-marker{display:none}
  .prompt-box summary::before{content:"▸ ";color:var(--primary)}
  .prompt-box[open] summary::before{content:"▾ "}
  .prompt-pre{
    margin:10px 0 0;
    padding:14px;
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:8px;
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    line-height:1.7;
    color:var(--text);
    white-space:pre-wrap;
    word-break:break-word;
    max-height:460px;
    overflow:auto;
  }

  /* 更新日志 */
  .changelog{display:flex;flex-direction:column;gap:14px;margin-top:4px}
  .log-item{display:flex;gap:10px;align-items:flex-start}
  .log-ver{
    flex-shrink:0;
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    font-weight:700;
    padding:2px 8px;
    border-radius:999px;
    background:rgba(37,99,235,.1);
    color:var(--primary);
    border:1px solid rgba(37,99,235,.2);
    line-height:1.7;
  }
  .log-body{flex:1;min-width:0}
  .log-note{font-size:.76rem;color:var(--text-muted);margin-top:6px;line-height:1.6}
  .log-title{
    font-size:.82rem;
    font-weight:700;
    margin-bottom:4px;
  }
  .log-body ul{
    margin:0;
    padding-left:18px;
    font-size:.78rem;
    color:var(--text-muted);
    line-height:1.8;
  }
  .log-body li code{
    font-family:"SF Mono",Monaco,Consolas,monospace;
    font-size:.72rem;
    color:var(--text);
    background:var(--bg);
    border:1px solid var(--border);
    border-radius:4px;
    padding:0 4px;
  }
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-icon">⚡</div>
    <span>GH Proxy</span>
  </div>
  <span class="badge">Cloudflare Workers</span>
</header>

<main>
  <div class="notice">
    基于 <a href="https://github.com/hunshcn/gh-proxy" target="_blank" rel="noopener noreferrer">gh-proxy</a>
    二次开发 · 由 <b>AI</b> 修改维护 · <span class="ver" id="verTag">__VERSION__</span>
  </div>

  <section class="hero">
    <h1>GitHub 资源加速下载</h1>
    <p>粘贴 GitHub 链接，一键生成加速地址</p>
  </section>

  <!-- 输入区 -->
  <div class="card">
    <div class="input-group">
      <label class="input-label" for="urlInput">GitHub 链接</label>
      <input
        type="text"
        id="urlInput"
        class="url-input"
        placeholder="https://github.com/user/repo/releases/download/v1.0/file.zip"
        autocomplete="off"
        spellcheck="false"
      >
      <div class="btn-row">
        <button class="btn btn-primary" id="generateBtn" disabled>
          <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          生成加速链接
        </button>
        <button class="btn btn-secondary" id="clearBtn">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          清空
        </button>
        <button class="settings-toggle" id="settingsBtn" style="margin-left:auto">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          代理地址
        </button>
      </div>

      <!-- 代理地址 / 令牌设置 -->
      <div class="settings-panel" id="settingsPanel">
        <label for="proxyInput">自定义 Worker 代理地址（留空则使用当前域名）</label>
        <input type="text" id="proxyInput" placeholder="https://your-worker.workers.dev" spellcheck="false">
        <label for="tokenInput" style="margin-top:10px">访问令牌（服务端 Config.auth 非空时才需要填）</label>
        <input type="text" id="tokenInput" placeholder="留空 = 服务端未启用鉴权" spellcheck="false" autocomplete="off">
      </div>

      <!-- 状态提示 -->
      <div class="status" id="statusBox"></div>
    </div>
  </div>

  <!-- 结果区 -->
  <div class="card result-card" id="resultCard">
    <div class="result-header">
      <div class="result-title">
        <span class="dot"></span>
        加速链接已生成
      </div>
    </div>
    <div class="result-url" id="resultUrl"></div>
    <div class="result-actions">
      <button class="btn btn-primary" id="copyBtn">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        复制链接
      </button>
      <a class="btn btn-secondary" id="openBtn" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        直接打开
      </a>
      <button class="btn btn-secondary" id="downloadBtn">
        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        下载文件
      </button>
    </div>

    <!-- 更多下载方式 -->
    <button class="more-toggle" id="moreToggle">
      <span>更多下载方式</span>
      <svg class="arrow" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
    </button>
    <div class="more-panel" id="morePanel">
      <div class="more-group">
        <div class="more-group-label">命令行下载</div>
        <div class="chip-row">
          <button class="chip" data-cmd="aria2">
            <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H6v-2h8v2zm4-4H6v-2h12v2z"/></svg>
            aria2c
          </button>
          <button class="chip" data-cmd="wget">
            <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            wget
          </button>
          <button class="chip" data-cmd="curl">
            <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H6v-2h8v2zm4-4H6v-2h12v2z"/></svg>
            curl
          </button>
        </div>
      </div>
      <div class="more-group">
        <div class="more-group-label">本地应用唤起</div>
        <div class="chip-row">
          <button class="chip" id="motrixBtn">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Motrix
          </button>
          <button class="chip" id="folxBtn">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Folx
          </button>
          <button class="chip" id="fdmBtn">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            FDM
          </button>
        </div>
      </div>
      <div class="more-group">
        <div class="more-group-label">私有协议链接</div>
        <div class="chip-row">
          <button class="chip" id="thunderBtn">
            <svg viewBox="0 0 24 24"><path d="M18 2h-8L4 8v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12h-4v3l-5-5 5-5v3h4v4z"/></svg>
            迅雷
          </button>
          <button class="chip" id="qqdlBtn">
            <svg viewBox="0 0 24 24"><path d="M18 2h-8L4 8v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12h-4v3l-5-5 5-5v3h4v4z"/></svg>
            QQ旋风
          </button>
          <button class="chip" id="flashgetBtn">
            <svg viewBox="0 0 24 24"><path d="M18 2h-8L4 8v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12h-4v3l-5-5 5-5v3h4v4z"/></svg>
            快车
          </button>
          <button class="chip" id="bitcometBtn">
            <svg viewBox="0 0 24 24"><path d="M18 2h-8L4 8v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12h-4v3l-5-5 5-5v3h4v4z"/></svg>
            BitComet
          </button>
          <button class="chip" id="jdownloaderBtn">
            <svg viewBox="0 0 24 24"><path d="M18 2h-8L4 8v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12h-4v3l-5-5 5-5v3h4v4z"/></svg>
            JDownloader
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 仓库快捷下载（粘贴 github.com/user/repo 时出现） -->
  <div class="card result-card" id="repoCard">
    <div class="result-header">
      <div class="result-title">
        <span class="dot"></span>
        检测到仓库链接，已生成快捷下载
      </div>
    </div>
    <div class="chip-row" style="margin-bottom:12px">
      <button class="chip" id="repoZipBtn">仓库 ZIP</button>
      <button class="chip" id="repoTgzBtn">仓库 tar.gz</button>
      <button class="chip" id="repoLatestBtn">最新发行版（盲选）</button>
      <button class="chip" id="repoJsonBtn">更新 API（JSON）</button>
    </div>
    <div class="result-url" id="repoUrl" style="margin-bottom:0"></div>
  </div>

  <!-- 支持的链接类型 -->
  <div class="card info-card">
    <h3>支持的链接类型</h3>
    <div class="type-grid">
      <div class="type-item"><code>github.com/.../releases/</code></div>
      <div class="type-item"><code>github.com/.../archive/</code></div>
      <div class="type-item"><code>github.com/.../blob/</code></div>
      <div class="type-item"><code>github.com/.../raw/</code></div>
      <div class="type-item"><code>raw.githubusercontent.com/...</code></div>
      <div class="type-item"><code>gist.github.com/...</code></div>
      <div class="type-item"><code>github.com/.../tags</code></div>
      <div class="type-item"><code>github.com/.../info/refs</code></div>
      <div class="type-item"><code>github.com/user/repo</code>（整仓库）</div>
      <div class="type-item"><code>.../releases/latest/download</code>（盲选）</div>
      <div class="type-item"><code>.../releases/latest/json</code>（更新 API）</div>
    </div>
  </div>

  <!-- 进阶用法 -->
  <div class="card info-card">
    <h3>进阶用法</h3>

    <div class="adv-label">① 克隆仓库</div>
    <div class="adv-row"><code id="advClone"></code><button class="chip mini-chip" id="advCloneCopy">复制</button></div>
    <div class="adv-note">clone / pull / push 都走代理，<code>Authorization</code> 等凭据头会透传给 GitHub。</div>

    <div class="adv-label">② 盲选最新发行版（不用知道版本号）</div>
    <div class="adv-row"><code id="advBlind"></code><button class="chip mini-chip" id="advBlindCopy">复制</button></div>
    <div class="adv-note">只有一个资产时直接 302 到它；多个资产时加 <code>?match=正则</code> 按文件名筛，例如 <code>?match=win.*x64</code>。命中多个或一个都没命中会返回 409 并列出全部候选，不会随便塞给你一个文件。</div>

    <div class="adv-label">③ 更新检查 API（JSON，给应用调用）</div>
    <div class="adv-row"><code id="advJson"></code><button class="chip mini-chip" id="advJsonCopy">复制</button></div>
    <div class="adv-note">返回最新 release 的版本号与全部资产，<code>assets[].url</code> 已经是本代理地址，可直接下载：</div>
    <pre class="adv-pre">{
  "tag": "v1.2.3",
  "name": "v1.2.3",
  "prerelease": false,
  "published_at": "2026-11-20T09:12:33Z",
  "assets": [
    {
      "name": "app-win-x64.zip",
      "size": 18345216,
      "url": "<span id="advJsonSampleUrl">https://你的域名/https://github.com/user/repo/releases/download/v1.2.3/app-win-x64.zip</span>"
    }
  ],
  "zipball_url": "…/archive/refs/tags/v1.2.3.zip",
  "tarball_url": "…/archive/refs/tags/v1.2.3.tar.gz"
}</pre>
    <div class="adv-note">应用侧流程：GET 这个地址 → 比对 <code>tag</code> 与本地版本 → 在 <code>assets[]</code> 里按 <code>name</code> 挑自己平台的产物 → 下载 <code>assets[].url</code>。<br>没有上传二进制资产时 <code>assets</code> 为空，可退而取 <code>zipball_url</code> 源码包；私有仓库请带 <code>Authorization</code> 头；匿名请求受 api.github.com 每小时 60 次限制，客户端建议缓存结果（例如 10 分钟）。</div>

    <div class="adv-note">跨域已放开：<code>access-control-allow-origin: *</code>，浏览器里可直接 fetch。</div>

    <div class="adv-label">④ 应用内最小示例（浏览器 / Electron / Node 18+ 通用）</div>
    <pre class="adv-pre">const LOCAL_VERSION = '1.0.0'   // ← 换成你应用自己的版本来源
const API = location.origin + '/https://github.com/user/repo/releases/latest/json'

const res = await fetch(API, { signal: AbortSignal.timeout(8000) })
if (!res.ok) return                      // 404 没有 release / 502 上游出错：静默跳过
const info = await res.json()

if (info.tag !== LOCAL_VERSION) {
  const pick = info.assets
    .filter(a =&gt; !/sha256|\.sig$|checksum/i.test(a.name))   // 先剔掉校验文件
    .find(a =&gt; /win.*x64/i.test(a.name))                     // 自己平台的唯一命中
  if (pick) console.log(info.tag, pick.url, pick.size)      // 拿 url 直接下载
}</pre>
    <div class="adv-note">挑选规则：先剔除 <code>sha256</code> / <code>.sig</code> / <code>checksum</code> 这类校验文件 → 按平台词表（<code>win|windows|.exe|.msi</code>、<code>mac|osx|.dmg</code>、<code>linux|.deb|.rpm|.AppImage</code>）→ 按架构（<code>x64|amd64|x86_64</code>、<code>arm64|aarch64</code>）。<b>命中 0 个或多个都不要猜</b>，把 <code>assets[].name</code> 列表交给用户选 —— 服务端也只在唯一命中时才给文件，多资产会回 409。</div>
    <div class="adv-note">失败一律降级：超时 / <code>404</code> / <code>502</code> 只记日志、不阻断启动；同一进程内缓存 10 分钟；<code>502</code> 最多退避重试一次。令牌（若开启）放请求头 <code>x-proxy-token</code>，别拼进日志。</div>
  </div>

  <!-- 提示词：让应用接入盲选 / JSON 更新渠道 -->
  <div class="card info-card">
    <div class="prompt-head">
      <h3>盲选更新渠道 · 提示词</h3>
      <button class="chip" id="promptCopyBtn">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        复制全文
      </button>
    </div>
    <div class="adv-note" style="margin-top:8px">把下面整段交给应用仓库里的 AI 助手：<b>代理地址已按当前域名写好</b>，剩下的仓库信息（OWNER / REPO / 版本来源）它自己读得到，读不到的它只问一次。</div>
    <details class="prompt-box">
      <summary>展开 / 收起提示词全文</summary>
      <pre class="prompt-pre" id="promptPre">你正在维护本应用。现在要给它增加一个「自动检查更新」的渠道，更新信息来自一个已经部署好的 GitHub 代理服务（下称 PROXY）。**服务端已经写好，不要修改它，也不要在应用里直接访问 api.github.com。**

## 一、接口契约（照此对接，不要猜测字段）

**代理地址已经定好，就是 &#96;{PROXY_BASE}&#96;（无尾斜杠）。** 本文所有示例都以它开头，原样照抄即可：不要向用户索取这个地址，也不要换成 &#96;api.github.com&#96;。

**1) 更新检查（只读，返回 JSON）**

&#96;&#96;&#96;
GET {PROXY_BASE}/https://github.com/{OWNER}/{REPO}/releases/latest/json
&#96;&#96;&#96;

200 返回（字段可能为 null，但键一定存在）：

&#96;&#96;&#96;json
{
  "tag": "v1.2.3",
  "name": "v1.2.3",
  "prerelease": false,
  "published_at": "2026-11-20T09:12:33Z",
  "assets": [
    { "name": "app-win-x64.zip", "size": 18345216,
      "url": "{PROXY_BASE}/https://github.com/o/r/releases/download/v1.2.3/app-win-x64.zip" }
  ],
  "zipball_url": "{PROXY_BASE}/https://github.com/o/r/archive/refs/tags/v1.2.3.zip",
  "tarball_url": "{PROXY_BASE}/https://github.com/o/r/archive/refs/tags/v1.2.3.tar.gz"
}
&#96;&#96;&#96;

要点：

- &#96;assets[].url&#96; **已经是可直接下载的代理地址**，不要再拼 github.com，也不要再改写。
- &#96;assets&#96; 可能为空数组（项目只发源码，没有上传二进制），此时用 &#96;zipball_url&#96;。
- 响应头带 &#96;access-control-allow-origin: *&#96;，浏览器/Electron/WebView 里可直接 fetch。
- **没有 ETag / 304**：不要依赖 HTTP 缓存协商，缓存由客户端自己做。

**2) 盲选下载（可选，给你一条"永远指向最新版"的固定 URL）**

&#96;&#96;&#96;
GET {PROXY_BASE}/https://github.com/{OWNER}/{REPO}/releases/latest/download          # 唯一资产时 302
GET {PROXY_BASE}/https://github.com/{OWNER}/{REPO}/releases/latest/download?match=win.*x64   # 按文件名正则筛
&#96;&#96;&#96;

- 成功：&#96;302&#96;，&#96;Location&#96; 是代理后的真实资产地址（&#96;?token=&#96; 会自动带上）。
- 多资产且未给 &#96;match&#96;，或给了 &#96;match&#96; 但现有资产里一个都没匹配上：&#96;409&#96;，body 是
  &#96;{ "error": "multiple assets found, append ?match=&lt;regex> to pick one", "assets": [{ "name": "...", "url": "..." }] }&#96;
  → 这是「让你选」的信号，不要当成失败重试。
- 仓库一个资产都没上传时，&#96;download&#96; 会回退成最新源码 zipball（&#96;302&#96;）；想要「没有二进制就明确报错」，请走 JSON 端点自行判断 &#96;assets&#96; 是否为空。
- 其他错误码：&#96;400&#96; 正则非法；&#96;404&#96; 仓库不存在或还没有 release；&#96;401&#96; 代理要求令牌；&#96;502&#96; 上游 GitHub API 出错（含匿名限额 60 次/小时·IP）。

**3) 令牌**（仅当部署方开启了鉴权）：三种任选其一，&#96;?token=xxx&#96;、请求头 &#96;x-proxy-token: xxx&#96;、Cookie &#96;ghproxy_token=xxx&#96;。JSON 里的 &#96;url&#96; 会自动带上 &#96;?token=&#96;，所以只给 JSON 请求加令牌即可。

## 二、要实现的东西

按顺序实现，每步都要能被独立测试：

1. **&#96;getLatestRelease()&#96;** — 请求上面的 JSON 端点，&#96;timeout≈8s&#96;，校验响应是 JSON 且含 &#96;tag&#96; 字段，否则视为失败。
2. **&#96;compareVersion(local, remote)&#96;** — 忽略前缀 &#96;v&#96;/&#96;V&#96;，按数字段比较（&#96;1.2.10 > 1.2.9&#96;），非数字后缀（&#96;-beta.1&#96;）单独处理：只有本地是稳定版时才提示预发布版。
3. **&#96;pickAsset(assets, platform, arch)&#96;** — 依次过滤：
   - 先排除明显的非二进制：名字匹配 &#96;sha256|sha512|\.sig$|\.asc$|checksum|\.txt$&#96; 的一律丢掉；
   - 再按平台词表匹配：Windows → &#96;win|windows|\.exe$|\.msi$|\.zip$&#96;，macOS → &#96;mac|macos|osx|darwin|\.dmg$|\.pkg$&#96;，Linux → &#96;linux|\.deb$|\.rpm$|\.AppImage$|\.tar\.gz$&#96;；
   - 再按架构：&#96;x64|amd64|x86_64&#96;、&#96;arm64|aarch64&#96;、&#96;x86|386|i686&#96;；
   - **命中必须唯一**：0 个或 ≥2 个都不要猜，把 &#96;assets[].name&#96; 列表交给用户/上层逻辑选，并说明原因。
4. **&#96;downloadAndVerify(url, dest)&#96;** — 流式下载到临时文件（不要整块读进内存），支持续传（&#96;Range&#96; 头可用）；下载完成后校验 &#96;size&#96; 与 JSON 里记录的一致；有 &#96;*.sha256&#96; 资产时一并校验。
5. **接入点** — 提供一个显式的「检查更新」入口（菜单项/命令 &#96;--check-update&#96; 均可），以及可选的后台静默检查（启动后延迟 10s 再查，失败静默）。**绝不阻塞启动、绝不自动替换正在运行的程序**：只下载到临时目录，由用户确认后安装。
6. **配置** — &#96;PROXY_BASE&#96;（默认值就是本文开头那个地址，不要留空、不要问用户）、&#96;OWNER/REPO&#96;、是否启用、检查间隔，全部走配置/环境变量，不要硬编码在业务逻辑里。

## 三、必须遵守的约束

- **失败一律降级**：网络错、超时、&#96;502&#96;、&#96;409&#96; 都只记录日志并保持应用可用；用户手动操作时给出可读提示，不抛栈、不弹阻断弹窗。
- **限流**：客户端缓存成功结果（默认 10 分钟），同一次运行内不重复请求；收到 &#96;502&#96; 时指数退避（1 次重试，间隔 ≥3s），不要循环重试。
- **安全**：令牌只放请求头或已存的配置里，**不要写进日志、URL 里的查询串和崩溃报告**。
- **不要**自己解析 &#96;releases&#96; 网页、不要抓 &#96;api.github.com&#96;、不要假设 &#96;assets[].name&#96; 有统一命名规范——一切以 JSON 里的 &#96;name&#96; 为准。

## 四、交付与自测

- 给出改动文件清单和一段最小 diff；新增逻辑要有单元测试，用 mock 覆盖四种响应：&#96;200 正常&#96;、&#96;200 但 assets 为空&#96;、&#96;409 多资产&#96;、&#96;502 上游错误&#96;。
- 自测命令（把占位符换掉后原样可跑）：

&#96;&#96;&#96;bash
curl -s "{PROXY_BASE}/https://github.com/{OWNER}/{REPO}/releases/latest/json" | head -30
curl -sI "{PROXY_BASE}/https://github.com/{OWNER}/{REPO}/releases/latest/download" | head -3
&#96;&#96;&#96;

- 最后告诉我：你怎么判定平台/架构、命中多个资产时怎么处理、失败时用户看到什么。

## 五、还要确定的信息（能自己读到的就别问用户）

| 项 | 值 | 怎么拿到 |
| --- | --- | --- |
| &#96;{OWNER}&#96; / &#96;{REPO}&#96; |  | 读当前仓库的 &#96;git remote -v&#96;，不要问用户 |
| 本地版本从哪读 |  | 自己去仓库里找：&#96;package.json&#96; / &#96;Cargo.toml&#96; / &#96;pyproject.toml&#96; / 编译期常量 |
| 目标平台与架构 |  | 从构建矩阵或发布工作流推断；推断不出就**一次性**问用户，别来回磨 |
| 是否启用令牌 |  | 默认不启用；启用时令牌只从配置/环境变量读 |

&#96;{PROXY_BASE}&#96; 不在上面 —— 它已经写在提示词里了，直接用，不要问、不要猜、不要换。</pre>
    </details>
  </div>

  <!-- 更新日志：只保留最近三版的逐条记录；更早的并入最下方那条「早期汇总」。
       汇总条只讲「与原项目 gh-proxy 的区别」，不追述中间过程。发版时：加一条新的，
       并把挤出去的第四条并进汇总条。 -->
  <!-- 更新日志 -->
  <div class="card info-card">
    <h3>更新日志</h3>
    <div class="changelog">
      <div class="log-item">
        <span class="log-ver">v1.6</span>
        <div class="log-body">
          <div class="log-title">源码链接改为可选配置</div>
          <ul>
            <li>页脚是否显示源码链接，只由 <code>Config.sourceUrl</code> 决定：填一个 <code>http(s)</code> 地址才渲染，留空则不显示（默认留空）</li>
            <li>该值只接受 <code>http(s)</code> 并做属性转义，写引号也破坏不了页面；其他写法一律忽略</li>
            <li>曾试过把脚本自身 base64 内嵌、由本站 <code>/source</code> 直出源码，但脚本体积从 ~70KB 涨到 ~172KB，已整体回退、不留残余代码</li>
          </ul>
        </div>
      </div>
      <div class="log-item">
        <span class="log-ver">v1.5</span>
        <div class="log-body">
          <div class="log-title">配置项集中到脚本头部</div>
          <ul>
            <li>新增文件头部「配置区」：<code>VERSION</code> / <code>PREFIX</code> / <code>whiteList</code> / <code>Config</code> 全部集中，部署时只看开头</li>
            <li><code>Config</code> 增补高级项 <code>githubApi</code> / <code>userAgent</code> / <code>cookieMaxAge</code>，改它们不用碰逻辑代码</li>
            <li>版本号改为单一来源：后端的 <code>VERSION</code> 注入页面徽标，前端不再另存一份</li>
            <li>脚本头部不再重复记录版本日志，以本卡为唯一记录处</li>
          </ul>
        </div>
      </div>
      <div class="log-item">
        <span class="log-ver">v1.4</span>
        <div class="log-body">
          <div class="log-title">源码署名归位</div>
          <ul>
            <li>页脚原来的「项目源码」指向原项目 <code>hunshcn/gh-proxy</code>，容易被当成这版代码的地址；现在上游只作署名</li>
            <li>新增 <code>Config.sourceUrl</code>：填 Gist 或自己仓库的地址，页脚就渲染「查看源码」；留空则不显示</li>
            <li>该地址只接受 <code>http(s)</code>，并做属性转义，配置里写引号也破坏不了页面</li>
          </ul>
        </div>
      </div>
      <div class="log-item">
        <span class="log-ver">v1.0–v1.3</span>
        <div class="log-body">
          <div class="log-title">早期汇总：与原项目 gh-proxy 的区别</div>
          <ul>
            <li><b>形态</b>：原项目是 Service Worker 语法的多文件 Worker，前端静态资源托管在 <code>hunshcn.github.io/gh-proxy</code>；本版压成单文件，页面内联，根路径直接返回（<code>ASSET_URL</code> 只作注释保留，不再远程加载）</li>
            <li><b>前端</b>：原项目只有 404 跳转页。本版内置首页：链接校验与加速链接生成、代理地址可改并记在 <code>localStorage</code>、更多下载方式（aria2 / wget / curl、Motrix / Folx / FDM、迅雷 / QQ旋风 / 快车 / BitComet / JDownloader）、整仓库快捷下载、进阶用法</li>
            <li><b>新增鉴权</b>：<code>Config.auth</code> 访问令牌（默认关闭），<code>?token=</code> / <code>x-proxy-token</code> 头 / <code>ghproxy_token</code> Cookie 三选一，令牌不会转发给 GitHub</li>
            <li><b>新增盲选与更新 API</b>：<code>/releases/latest/download</code> 直接取最新发行版资产，<code>/releases/latest/json</code> 返回版本号与已代理的资产地址；<code>?match=</code> 正则选资产、唯一命中直选、多资产 409 列候选、无资产回退 zipball、<code>authorization</code> 透传支持私有仓库</li>
            <li><b>健壮性</b>：相对 Location 按当前 URL 兜底解析；跨域跟随降级为 GET，规避 <code>Response body object should not be disturbed or locked</code>；目标地址解析失败返回 <code>400 invalid target url</code>，不再是 502 堆栈</li>
            <li><b>署名与配置</b>：页脚上游只作署名，不再标成「项目源码」；配置项集中到脚本头部；版本号单一来源，由后端注入页面徽标</li>
          </ul>
          <div class="log-note">v1.3 及更早的逐版本记录已合并到这一处（只保留主题级差异）；v1.4 起恢复逐版本记录，任何人都能看懂每一版做了什么。</div>
        </div>
      </div>
    </div>
  </div>
</main>

<footer>
  基于 <a href="https://github.com/hunshcn/gh-proxy" target="_blank" rel="noopener noreferrer">gh-proxy</a> · 由 AI 修改维护 · 部署于 Cloudflare Workers<!-- SOURCE_LINK -->
</footer>

<script>
(function(){
  'use strict';

  // ========== 与后端一致的 URL 校验规则 ==========
  var exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
  var exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
  var exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
  var exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
  var exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
  var exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;
  var allPatterns = [exp1, exp2, exp3, exp4, exp5, exp6];

  // 仓库主页（整仓库快捷下载）
  var repoRe = /^(?:https?:\/\/)?github\.com\/([^\/\s]+)\/([^\/\s]+?)\/?$/i;

  function checkUrl(u){
    for(var i=0;i<allPatterns.length;i++){
      if(u.search(allPatterns[i]) === 0) return true;
    }
    return false;
  }

  // ========== DOM ==========
  var urlInput    = document.getElementById('urlInput');
  var generateBtn = document.getElementById('generateBtn');
  var clearBtn    = document.getElementById('clearBtn');
  var statusBox   = document.getElementById('statusBox');
  var resultCard  = document.getElementById('resultCard');
  var resultUrl   = document.getElementById('resultUrl');
  var copyBtn     = document.getElementById('copyBtn');
  var openBtn     = document.getElementById('openBtn');
  var downloadBtn = document.getElementById('downloadBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsPanel= document.getElementById('settingsPanel');
  var proxyInput  = document.getElementById('proxyInput');
  var tokenInput  = document.getElementById('tokenInput');
  var moreToggle  = document.getElementById('moreToggle');
  var morePanel   = document.getElementById('morePanel');
  var repoCard    = document.getElementById('repoCard');
  var repoUrl     = document.getElementById('repoUrl');
  var motrixBtn   = document.getElementById('motrixBtn');
  var folxBtn     = document.getElementById('folxBtn');
  var fdmBtn      = document.getElementById('fdmBtn');
  var thunderBtn  = document.getElementById('thunderBtn');
  var qqdlBtn     = document.getElementById('qqdlBtn');
  var flashgetBtn = document.getElementById('flashgetBtn');
  var bitcometBtn = document.getElementById('bitcometBtn');
  var jdownloaderBtn = document.getElementById('jdownloaderBtn');
  var cmdBtns     = document.querySelectorAll('[data-cmd]');

  // ========== 状态提示 ==========
  function showStatus(msg, type){
    statusBox.textContent = msg;
    statusBox.className = 'status show status-' + type;
    if(type === 'success'){
      setTimeout(function(){ statusBox.classList.remove('show'); }, 2500);
    }
  }
  function hideStatus(){ statusBox.classList.remove('show'); }

  // ========== 获取代理前缀 ==========
  function getProxyBase(){
    var custom = proxyInput.value.trim();
    if(custom){
      // 确保以 / 结尾
      return custom.replace(/\/+$/, '') + '/';
    }
    // 默认使用当前页面域名（与 Worker 同域部署时）
    return window.location.origin + '/';
  }

  // ========== 附加访问令牌（服务端启用 Config.auth 时） ==========
  function withToken(u){
    var t = tokenInput.value.trim();
    if(!t) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
  }

  // ========== 生成加速链接 ==========
  function generate(){
    var raw = urlInput.value.trim();
    if(!raw){
      showStatus('请输入 GitHub 链接', 'error');
      return;
    }
    // 仓库主页 → 整仓库 / 最新发行版快捷链接
    var stripped = raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
    var mRepo = stripped.match(repoRe);
    if(mRepo){
      showRepoLinks(mRepo[1], mRepo[2]);
      resultCard.classList.remove('show');
      morePanel.classList.remove('show');
      moreToggle.classList.remove('open');
      hideStatus();
      showStatus('整仓库快捷链接已生成', 'success');
      return;
    }
    if(!checkUrl(raw)){
      showStatus('链接格式不支持，请确认是 GitHub releases / raw / gist / archive 等链接', 'error');
      resultCard.classList.remove('show');
      return;
    }
    // 补全协议
    var normalized = raw;
    if(!/^https?:\/\//i.test(normalized)){
      normalized = 'https://' + normalized;
    }
    var proxied = withToken(getProxyBase() + normalized);
    resultUrl.textContent = proxied;
    openBtn.href = proxied;
    resultCard.classList.add('show');
    // 生成新链接时收起更多面板
    morePanel.classList.remove('show');
    moreToggle.classList.remove('open');
    hideStatus();
    showStatus('加速链接生成成功', 'success');
  }

  // ========== 整仓库快捷链接 ==========
  var repoLinks = {};

  function showRepoLinks(user, repo){
    var base = getProxyBase() + 'https://github.com/' + user + '/' + repo;
    repoLinks.repoZipBtn    = withToken(base + '/archive/HEAD.zip');
    repoLinks.repoTgzBtn    = withToken(base + '/archive/HEAD.tar.gz');
    repoLinks.repoLatestBtn = withToken(base + '/releases/latest/download');
    repoLinks.repoJsonBtn   = withToken(base + '/releases/latest/json');
    repoUrl.textContent = repoLinks.repoLatestBtn;
    repoCard.classList.add('show');
  }

  function bindRepoChip(id){
    document.getElementById(id).addEventListener('click', function(){
      var u = repoLinks[id];
      if(!u) return;
      repoUrl.textContent = u;
      copyText(u, document.getElementById(id), '已复制，可直接粘贴使用');
    });
  }
  bindRepoChip('repoZipBtn');
  bindRepoChip('repoTgzBtn');
  bindRepoChip('repoLatestBtn');
  bindRepoChip('repoJsonBtn');

  // ========== 通用复制 ==========
  function copyText(text, btn, successMsg){
    var done = function(){
      showStatus(successMsg || '已复制到剪贴板', 'success');
      if(btn){
        btn.classList.add('copied');
        setTimeout(function(){ btn.classList.remove('copied'); }, 1500);
      }
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, cb){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); if(cb) cb(); }
    catch(e){ showStatus('复制失败，请手动复制', 'error'); }
    document.body.removeChild(ta);
  }

  // 复制加速链接（主按钮）
  function copyLink(){
    var text = resultUrl.textContent;
    if(!text) return;
    copyText(text, copyBtn, '加速链接已复制');
  }

  // ========== 命令行生成 ==========
  function buildCmd(type){
    var url = resultUrl.textContent;
    if(!url) return '';
    // 提取文件名
    var raw = urlInput.value.trim();
    var parts = raw.split('/');
    var filename = parts[parts.length - 1] || 'download';
    switch(type){
      case 'aria2':
        return 'aria2c -x16 -s16 -k1M -o "' + filename + '" "' + url + '"';
      case 'wget':
        return 'wget -c -O "' + filename + '" "' + url + '"';
      case 'curl':
        return 'curl -L -o "' + filename + '" "' + url + '"';
      default:
        return url;
    }
  }

  // ========== 迅雷链接编码 ==========
  function toThunder(url){
    // thunder:// + base64("AA" + url + "ZZ")
    var raw = 'AA' + url + 'ZZ';
    return 'thunder://' + safeBase64(raw);
  }

  // ========== QQ旋风链接编码 ==========
  function toQQDownload(url){
    // qqdl:// + base64(url)
    return 'qqdl://' + safeBase64(url);
  }

  // ========== 快车(FlashGet)链接编码 ==========
  function toFlashGet(url){
    // flashget:// + base64("[FLASHGET]" + url + "[FLASHGET]")
    var raw = '[FLASHGET]' + url + '[FLASHGET]';
    return 'flashget://' + safeBase64(raw);
  }

  // ========== BitComet链接编码 ==========
  function toBitComet(url){
    // bc://http2/\${TaskName}/?url=\${url}
    // 从URL提取文件名作为任务名
    var parts = url.split('/');
    var filename = parts[parts.length - 1] || 'download';
    return 'bc://http2/' + encodeURIComponent(filename) + '/?url=' + encodeURIComponent(url);
  }

  // ========== JDownloader链接编码 ==========
  function toJDownloader(url){
    // jd:// 单链接：将 https:// 或 http:// 替换为 jd://
    return url.replace(/^https?:\/\//i, 'jd://');
  }

  // 安全 base64（兼容非 ASCII 字符）
  function safeBase64(str){
    try{
      return btoa(unescape(encodeURIComponent(str)));
    }catch(e){
      return btoa(str);
    }
  }

  // ========== 通用应用唤起 ==========
  function launchApp(protocol, url, btn, msg){
    if(!url) return;
    // 先复制链接，确保唤起失败时也能手动粘贴
    copyText(url, btn, msg);
    // 通过隐藏 iframe 尝试唤起本地应用
    try{
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = protocol + '://' + url;
      document.body.appendChild(iframe);
      setTimeout(function(){ if(iframe.parentNode) document.body.removeChild(iframe); }, 2000);
    }catch(e){}
  }

  // ========== Motrix 唤起 ==========
  function sendToMotrix(){
    launchApp('motrix', resultUrl.textContent, motrixBtn, '已复制链接，正在尝试唤起 Motrix…');
  }

  // ========== Folx 唤起 ==========
  function sendToFolx(){
    launchApp('folx', resultUrl.textContent, folxBtn, '已复制链接，正在尝试唤起 Folx…');
  }

  // ========== FDM 唤起 ==========
  function sendToFDM(){
    launchApp('fdm', resultUrl.textContent, fdmBtn, '已复制链接，正在尝试唤起 FDM…');
  }

  // ========== 下载文件 ==========
  function downloadFile(){
    var url = resultUrl.textContent;
    if(!url) return;
    // 尝试从原始链接提取文件名
    var raw = urlInput.value.trim();
    var parts = raw.split('/');
    var filename = parts[parts.length - 1] || 'download';
    // 触发下载（通过 a 标签 + download 属性）
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ========== 事件绑定 ==========
  urlInput.addEventListener('input', function(){
    var val = urlInput.value.trim();
    generateBtn.disabled = val.length === 0;
    if(resultCard.classList.contains('show')){
      resultCard.classList.remove('show');
    }
    if(repoCard.classList.contains('show')){
      repoCard.classList.remove('show');
    }
    hideStatus();
  });

  urlInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !generateBtn.disabled){
      generate();
    }
  });

  generateBtn.addEventListener('click', generate);
  copyBtn.addEventListener('click', copyLink);
  downloadBtn.addEventListener('click', downloadFile);

  // 更多下载方式面板
  moreToggle.addEventListener('click', function(){
    morePanel.classList.toggle('show');
    moreToggle.classList.toggle('open');
  });

  // 命令行复制按钮
  cmdBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      var type = btn.getAttribute('data-cmd');
      var cmd = buildCmd(type);
      if(cmd){
        var label = type === 'aria2' ? 'aria2c' : type;
        copyText(cmd, btn, label + ' 命令已复制');
      }
    });
  });

  // Motrix 唤起
  motrixBtn.addEventListener('click', sendToMotrix);

  // Folx 唤起
  folxBtn.addEventListener('click', sendToFolx);

  // FDM 唤起
  fdmBtn.addEventListener('click', sendToFDM);

  // 迅雷链接
  thunderBtn.addEventListener('click', function(){
    var url = resultUrl.textContent;
    if(!url) return;
    copyText(toThunder(url), thunderBtn, '迅雷链接已复制');
  });

  // QQ旋风链接
  qqdlBtn.addEventListener('click', function(){
    var url = resultUrl.textContent;
    if(!url) return;
    copyText(toQQDownload(url), qqdlBtn, 'QQ旋风链接已复制');
  });

  // 快车链接
  flashgetBtn.addEventListener('click', function(){
    var url = resultUrl.textContent;
    if(!url) return;
    copyText(toFlashGet(url), flashgetBtn, '快车链接已复制');
  });

  // BitComet链接
  bitcometBtn.addEventListener('click', function(){
    var url = resultUrl.textContent;
    if(!url) return;
    copyText(toBitComet(url), bitcometBtn, 'BitComet链接已复制');
  });

  // JDownloader链接
  jdownloaderBtn.addEventListener('click', function(){
    var url = resultUrl.textContent;
    if(!url) return;
    copyText(toJDownloader(url), jdownloaderBtn, 'JDownloader链接已复制');
  });

  clearBtn.addEventListener('click', function(){
    urlInput.value = '';
    generateBtn.disabled = true;
    resultCard.classList.remove('show');
    repoCard.classList.remove('show');
    morePanel.classList.remove('show');
    moreToggle.classList.remove('open');
    hideStatus();
    urlInput.focus();
  });

  settingsBtn.addEventListener('click', function(){
    settingsPanel.classList.toggle('show');
  });

  // 从 localStorage 恢复自定义代理地址 / 访问令牌
  try{
    var saved = localStorage.getItem('ghproxy_proxy_base');
    if(saved){ proxyInput.value = saved; }
  }catch(e){}
  proxyInput.addEventListener('change', function(){
    try{ localStorage.setItem('ghproxy_proxy_base', proxyInput.value.trim()); }catch(e){}
  });
  try{
    var savedToken = localStorage.getItem('ghproxy_token');
    if(savedToken){ tokenInput.value = savedToken; }
  }catch(e){}
  tokenInput.addEventListener('change', function(){
    try{ localStorage.setItem('ghproxy_token', tokenInput.value.trim()); }catch(e){}
  });

  // 进阶用法示例（用当前域名填充；file:// 本地预览时 origin 是 null，给个占位域名）
  var advOrigin = (window.location.origin && window.location.origin !== 'null')
    ? window.location.origin
    : 'https://your-worker.workers.dev';
  var advRepoBase = advOrigin + '/https://github.com/user/repo';
  document.getElementById('advClone').textContent = 'git clone ' + advRepoBase;
  document.getElementById('advBlind').textContent = advRepoBase + '/releases/latest/download';
  document.getElementById('advJson').textContent  = advRepoBase + '/releases/latest/json';
  // 示例 JSON 里的资产地址也换成当前域名，方便直接照抄
  try{
    document.getElementById('advJsonSampleUrl').textContent =
      advRepoBase + '/releases/download/v1.2.3/app-win-x64.zip';
  }catch(e){}
  function bindAdvCopy(btnId, codeId){
    var b = document.getElementById(btnId);
    b.addEventListener('click', function(){
      copyText(document.getElementById(codeId).textContent, b, '已复制');
    });
  }
  bindAdvCopy('advCloneCopy', 'advClone');
  bindAdvCopy('advBlindCopy', 'advBlind');
  bindAdvCopy('advJsonCopy', 'advJson');

  // 版本号由后端配置区的 VERSION 注入到 HTML（#verTag），前端不再单独维护一份

  // 复制「盲选更新渠道 · 提示词」全文
  var promptCopyBtn = document.getElementById('promptCopyBtn');
  if(promptCopyBtn){
    promptCopyBtn.addEventListener('click', function(){
      copyText(document.getElementById('promptPre').textContent, promptCopyBtn, '提示词全文已复制');
    });
  }

  // 提示词里的 {PROXY_BASE} 就地换成当前域名：拿到就能用，不必再问用户要地址
  var promptPre = document.getElementById('promptPre');
  if(promptPre && promptPre.textContent.indexOf('{PROXY_BASE}') >= 0){
    promptPre.textContent = promptPre.textContent.split('{PROXY_BASE}').join(advOrigin);
  }

  // 页面加载时聚焦输入框
  urlInput.focus();
})();
</script>
</body>
</html>
`

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}


const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

// 最新发行版盲选 / 更新 API 的伪路径：
//   github.com/{user}/{repo}/releases/latest/download  → 302 到最新 release 的资产
//   github.com/{user}/{repo}/releases/latest/json      → 精简 JSON（版本 + 已代理的资产 URL）
// 注意 download/文件名 的原生 GitHub 用法不受影响（正则结尾锚定，不会被这里拦截）
const latestRe = /^(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/latest\/(download|json)\/?(?:[?#]|$)/i

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, { status, headers })
}


/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}


/**
 * @param {Request} req
 * @param {string} name
 */
function getCookie(req, name) {
    const c = req.headers.get('cookie')
    if (!c) return null
    const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : null
}


function mkCookie(val, secure) {
    return 'ghproxy_token=' + encodeURIComponent(val) +
        '; Path=/; Max-Age=' + Config.cookieMaxAge + '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '')
}


addEventListener('fetch', e => {
    const ret = fetchHandler(e)
        .catch(err => makeRes('cfworker error:\n' + err.stack, 502))
    e.respondWith(ret)
})


function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}


/**
 * 渲染首页：
 *   1) 页脚源码链接按 Config.sourceUrl 注入（http(s) → 渲染；'' 或其他值 → 不渲染）
 *   2) 顶部徽标注入 VERSION
 * @returns {string}
 */
function renderIndexHTML() {
    const raw = String(Config.sourceUrl || '').trim()
    let link = ''
    if (/^https?:\/\//i.test(raw)) {
        // 外部链接：做属性转义，防止配置里写入引号破坏 HTML
        const safe = raw
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        link = ' · <a href="' + safe + '" target="_blank" rel="noopener noreferrer">查看源码</a>'
    }
    return INDEX_HTML
        .replace('<!-- SOURCE_LINK -->', link)
        .replace('__VERSION__', VERSION)
}


/**
 * @param {FetchEvent} e
 */
async function fetchHandler(e) {
    const req = e.request
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')
    if (path) {
        let dest = 'https://' + urlObj.host + PREFIX + path
        if (Config.auth) {
            const t = urlObj.searchParams.get('token')
            if (t) dest += (dest.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t)
        }
        return Response.redirect(dest, 301)
    }
    // cfworker 会把路径中的 `//` 合并成 `/`
    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

    // ===== 最新发行版盲选 / 更新 API（在常规分发之前拦截）=====
    const latestMatch = path.match(latestRe)
    if (latestMatch) {
        return latestReleaseHandler(req, urlObj, latestMatch[1], latestMatch[2], latestMatch[3])
    }

    if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0) {
        return httpHandler(req, path)
    } else if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else if (path.search(exp4) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        }
        else {
            return httpHandler(req, path)
        }
    } else {
        // 根路径返回自定义前端页面
        if (path === '' || path === '/') {
            return new Response(renderIndexHTML(), {
                status: 200,
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'access-control-allow-origin': '*'
                }
            })
        }
        // 其他无效路径返回 404
        return makeRes('Not Found', 404)
    }
}


/**
 * 最新发行版盲选与更新 API
 *
 * @param {Request} req
 * @param {URL} urlObj 本 worker 收到的请求 URL（含 ?match= / ?token= 参数）
 * @param {string} user
 * @param {string} repo
 * @param {'download'|'json'} mode
 *
 * download: 302 到最新 release 的资产文件。
 *   - ?match=正则  → 选第一个资产名匹配的资产
 *   - 无 match 且只有一个资产 → 直接选它
 *   - 无 match 且多个资产 → 409 + 候选列表（避免盲选错文件）
 *   - 没有上传的资产 → 回退最新源码 zipball
 * json: 返回 {tag, name, prerelease, published_at, assets:[{name,size,url}], zipball_url, tarball_url}，
 *   所有 url 均为本代理地址，可直接给应用作更新检查 API 使用。
 *
 * 注意：走 api.github.com 匿名限额 60 次/小时·IP（客户端带 authorization 头时会透传，可查私有仓库）。
 */
async function latestReleaseHandler(req, urlObj, user, repo, mode) {
    // 鉴权（Config.auth 非空时）
    let tokenQ = ''
    let cookie = null
    if (Config.auth) {
        const t = urlObj.searchParams.get('token')
        if (t && t === Config.auth) {
            tokenQ = '?token=' + encodeURIComponent(t)
            cookie = mkCookie(t, urlObj.protocol === 'https:')
        } else {
            const alt = req.headers.get('x-proxy-token') || getCookie(req, 'ghproxy_token')
            if (alt !== Config.auth) return makeRes('unauthorized', 401)
        }
    }

    const apiHdrs = {
        'accept': 'application/vnd.github+json',
        'user-agent': Config.userAgent,
    }
    // 私有仓库支持：客户端带 authorization 头时透传给 GitHub API
    if (req.headers.has('authorization')) apiHdrs['authorization'] = req.headers.get('authorization')

    const res = await fetch(Config.githubApi + '/repos/' + user + '/' + repo + '/releases/latest', { headers: apiHdrs })
    if (res.status === 404) return makeRes('repo not found or no releases yet', 404)
    if (!res.ok) return makeRes('github api error, status=' + res.status, 502)
    const data = await res.json()

    const proxied = function (u) { return urlObj.origin + PREFIX + u + tokenQ }
    const assets = (data.assets || []).map(function (a) {
        return { name: a.name, size: a.size, url: a.browser_download_url }
    })

    if (mode === 'json') {
        return makeRes(JSON.stringify({
            tag: data.tag_name,
            name: data.name || null,
            prerelease: !!data.prerelease,
            published_at: data.published_at,
            assets: assets.map(function (a) { return { name: a.name, size: a.size, url: proxied(a.url) } }),
            zipball_url: proxied(data.zipball_url),
            tarball_url: proxied(data.tarball_url),
        }, null, 2), 200, { 'content-type': 'application/json; charset=utf-8' })
    }

    // download 盲选
    let picked = null
    const matchRe = urlObj.searchParams.get('match')
    if (matchRe) {
        let re
        try { re = new RegExp(matchRe, 'i') } catch (err) { return makeRes('invalid match regex: ' + err.message, 400) }
        picked = assets.find(function (a) { return re.test(a.name) }) || null
    } else if (assets.length === 1) {
        picked = assets[0]
    }
    if (!picked) {
        if (assets.length === 0 && data.zipball_url) {
            picked = { name: 'source-zipball', url: data.zipball_url } // 无二进制资产 → 回退最新源码包
        } else {
            return makeRes(JSON.stringify({
                error: 'multiple assets found, append ?match=<regex> to pick one',
                assets: assets.map(function (a) { return { name: a.name, url: proxied(a.url) } }),
            }, null, 2), 409, { 'content-type': 'application/json; charset=utf-8' })
        }
    }
    const headers = { 'location': proxied(picked.url) }
    if (cookie) headers['set-cookie'] = cookie
    return new Response(null, { status: 302, headers })
}


/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // preflight
    if (req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

    // ===== 访问令牌校验（Config.auth 非空时启用）=====
    let cookieToSet = null
    if (Config.auth) {
        const reqUrl = new URL(req.url)
        const t = reqUrl.searchParams.get('token')
        if (t === Config.auth) {
            // 令牌放行并种 Cookie，浏览器后续 302 跳转无需重复带参
            cookieToSet = mkCookie(t, reqUrl.protocol === 'https:')
        } else {
            const alt = reqHdrRaw.get('x-proxy-token') || getCookie(req, 'ghproxy_token')
            if (alt !== Config.auth) return makeRes('unauthorized', 401)
        }
    }

    const reqHdrNew = new Headers(reqHdrRaw)
    reqHdrNew.delete('x-proxy-token') // 令牌头仅供本 worker 鉴权，不转发给 GitHub

    let urlStr = pathname
    let flag = !Boolean(whiteList.length)
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return new Response("blocked", { status: 403 })
    }
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)
    if (!urlObj) return makeRes('invalid target url', 400)
    if (Config.auth) {
        urlObj.searchParams.delete('token') // 令牌参数不转发给 GitHub
    }

    /** @type {RequestInit} */
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }
    if (cookieToSet) {
        return proxy(urlObj, reqInit).then(function (res) {
            res.headers.append('set-cookie', cookieToSet)
            return res
        })
    }
    return proxy(urlObj, reqInit)
}


/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location))
            resHdrNew.set('location', PREFIX + _location)
        else {
            // 相对 Location（RFC 7231 允许，GitHub 现网不会返回，纯兜底）：
            // 不解析就会 newUrl() 返回 null，proxy(null) 抛 TypeError → 502
            let nextUrl = newUrl(_location)
            if (!nextUrl) {
                try { nextUrl = newUrl(new URL(_location, urlObj.href).href) } catch (err) { nextUrl = null }
            }
            if (nextUrl) {
                // 跟随跨域跳转前必须处理 body：req.body 是只能消费一次的流，
                // 复用会抛 "Response body object should not be disturbed or locked" → 502。
                // 按 301/302 的通用语义降级为无 body 的 GET（浏览器对 POST+302 亦然）。
                if (reqInit.body) {
                    reqInit.method = 'GET'
                    reqInit.body = null
                    reqInit.headers.delete('content-length')
                    reqInit.headers.delete('content-type')
                }
                reqInit.redirect = 'follow'
                return proxy(nextUrl, reqInit)
            }
            // 兜底都失败：把原始 302 原样交给客户端
            return new Response(null, { status, headers: resHdrNew })
        }
    }
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    return new Response(res.body, {
        status,
        headers: resHdrNew,
    })
}
