// =================================================================================
//  项目: botzy-2api (Cloudflare Worker 单文件版)
//  版本: 8.2.0 (代号: Chimera Synthesis - Botzy)
//  作者: 首席AI执行官 (Principal AI Executive Officer)
//  协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
//  日期: 2025-11-10
//
//  描述:
//  本文件是一个完全自包含、可一键部署的 Cloudflare Worker。它将 botzy.hexabiz.com.pk
//  的后端聊天服务，无损地转换为一个高性能、兼容 OpenAI 标准的 API，并内置了一个
//  功能强大的"开发者驾驶舱"Web UI，用于实时监控、测试和集成。
//
//  v8.2.0 更新:
//  1. [新功能] 首次实现对 botzy.hexabiz.com.pk 服务的完整代理。
//  2. [架构] 采用 TransformStream 实现高效、实时的 SSE 流格式转换。
//  3. [兼容性] 同时支持流式和非流式两种响应模式。
//  4. [UI/UX] 严格遵循协议规范，构建了包含自定义元素和状态机的全功能开发者驾驶舱。
//
// =================================================================================

// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
// 架构核心：所有关键参数在此定义，后续逻辑必须从此对象读取。
const CONFIG = {
  // 项目元数据
  PROJECT_NAME: "botzy-2api",
  PROJECT_VERSION: "8.2.0",
  // 安全配置
  API_MASTER_KEY: "1", // 密钥已按协议要求设置为 "1"
  // 上游服务配置
  UPSTREAM_URL: "https://botzy.hexabiz.com.pk/api/hexabizApi",
  // 模型映射
  MODELS: [
    "L1T3-Ωᴹ²",
  ],
  DEFAULT_MODEL: "L1T3-Ωᴹ²",
};

// --- [第二部分: Worker 入口与路由] ---
// Cloudflare Worker 的主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 根据路径分发请求到不同的处理器
    if (url.pathname === '/') {
      return handleUI(request); // 处理根路径，返回开发者驾驶舱 UI
    } else if (url.pathname.startsWith('/v1/')) {
      return handleApi(request); // 处理 API 请求
    } else {
      // 对于所有其他路径，返回 404 Not Found
      return new Response(
        JSON.stringify({
          error: {
            message: `路径未找到: ${url.pathname}`,
            type: 'invalid_request_error',
            code: 'not_found'
          }
        }), {
          status: 404,
          headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
        }
      );
    }
  }
};

// --- [第三部分: API 代理逻辑] ---

/**
 * 处理所有 /v1/ 路径下的 API 请求
 * @param {Request} request - 传入的请求对象
 * @returns {Promise<Response>} - 返回给客户端的响应
 */
async function handleApi(request) {
  // 预检请求处理：对于 OPTIONS 方法，直接返回 CORS 头部，允许跨域访问
  if (request.method === 'OPTIONS') {
    return handleCorsPreflight();
  }

  // 认证检查：验证 Authorization 头部
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse('需要 Bearer Token 认证。', 401, 'unauthorized');
  }
  const token = authHeader.substring(7);
  if (token !== CONFIG.API_MASTER_KEY) {
    return createErrorResponse('无效的 API Key。', 403, 'invalid_api_key');
  }

  const url = new URL(request.url);
  const requestId = `chatcmpl-${crypto.randomUUID()}`;

  // 根据 API 路径执行不同操作
  if (url.pathname === '/v1/models') {
    return handleModelsRequest();
  } else if (url.pathname === '/v1/chat/completions') {
    return handleChatCompletions(request, requestId);
  } else {
    return createErrorResponse(`API 路径不支持: ${url.pathname}`, 404, 'not_found');
  }
}

/**
 * 处理 CORS 预检请求
 * @returns {Response}
 */
function handleCorsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * 创建标准化的 JSON 错误响应
 * @param {string} message - 错误信息
 * @param {number} status - HTTP 状态码
 * @param {string} code - 错误代码
 * @returns {Response}
 */
function createErrorResponse(message, status, code) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: 'api_error',
      code
    }
  }), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8'
    })
  });
}

/**
 * 处理 /v1/models 请求
 * @returns {Response}
 */
function handleModelsRequest() {
  const modelsData = {
    object: 'list',
    data: CONFIG.MODELS.map(modelId => ({
      id: modelId,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'botzy-2api',
    })),
  };
  return new Response(JSON.stringify(modelsData), {
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8'
    })
  });
}

/**
 * 处理 /v1/chat/completions 请求
 * @param {Request} request - 传入的请求对象
 * @param {string} requestId - 本次请求的唯一 ID
 * @returns {Promise<Response>}
 */
async function handleChatCompletions(request, requestId) {
  try {
    const requestData = await request.json();
    const upstreamPayload = transformRequestToUpstream(requestData);

    const upstreamResponse = await fetch(CONFIG.UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://botzy.hexabiz.com.pk',
        'Referer': 'https://botzy.hexabiz.com.pk/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'X-Request-ID': requestId, // 请求水印
      },
      body: JSON.stringify(upstreamPayload),
      // 暗示 Cloudflare 优先使用 HTTP/3
      cf: {
        http3: 'on'
      }
    });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      console.error(`上游服务错误: ${upstreamResponse.status}`, errorBody);
      return createErrorResponse(`上游服务返回错误 ${upstreamResponse.status}: ${errorBody}`, upstreamResponse.status, 'upstream_error');
    }

    // 检查是否为流式响应
    const contentType = upstreamResponse.headers.get('content-type');
    if (requestData.stream && contentType && contentType.includes('text/event-stream')) {
      // 创建转换流，将上游格式实时转换为 OpenAI 格式
      const transformStream = createUpstreamToOpenAIStream(requestId, requestData.model || CONFIG.DEFAULT_MODEL);
      
      // 优雅地处理背压
      const pipedStream = upstreamResponse.body.pipeThrough(transformStream);

      return new Response(pipedStream, {
        headers: corsHeaders({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Worker-Trace-ID': requestId, // 响应水印
        }),
      });
    } else {
        // 处理非流式响应
        const fullBody = await upstreamResponse.text();
        const openAIResponse = transformNonStreamResponse(fullBody, requestId, requestData.model || CONFIG.DEFAULT_MODEL);
        return new Response(JSON.stringify(openAIResponse), {
            headers: corsHeaders({
                'Content-Type': 'application/json; charset=utf-8',
                'X-Worker-Trace-ID': requestId,
            }),
        });
    }

  } catch (e) {
    console.error('处理聊天请求时发生异常:', e);
    return createErrorResponse(`处理请求时发生内部错误: ${e.message}`, 500, 'internal_server_error');
  }
}

/**
 * 将 OpenAI 格式的请求体转换为上游服务所需的格式
 * @param {object} requestData - OpenAI 格式的请求数据
 * @returns {object} - 上游服务格式的载荷
 */
function transformRequestToUpstream(requestData) {
  // 上游服务直接兼容 OpenAI 的 messages 格式，无需转换
  return {
    task: "chat",
    model: requestData.model || CONFIG.DEFAULT_MODEL,
    messages: requestData.messages,
    imageUrl: null,
    settings: {
      avatar: null,
      name: "",
      nickname: "",
      age: 0,
      gender: "other"
    }
  };
}

/**
 * 创建一个 TransformStream 用于将上游 SSE 流转换为 OpenAI 兼容格式
 * @param {string} requestId - 本次请求的唯一 ID
 * @param {string} model - 使用的模型名称
 * @returns {TransformStream}
 */
function createUpstreamToOpenAIStream(requestId, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留可能不完整的最后一行

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const dataStr = line.substring(5).trim();
          if (dataStr === '[DONE]') {
            // 上游的 [DONE] 信号，我们将在 flush 中发送我们自己的
            continue;
          }
          try {
            const data = JSON.parse(dataStr);
            // 检查是否是有效的聊天内容块
            const delta = data?.choices?.[0]?.delta;
            if (delta && typeof delta.content === 'string') {
              const openAIChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: delta.content },
                  finish_reason: null,
                }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
            }
          } catch (e) {
            // 忽略无法解析的或非内容的数据块
            // console.warn('无法解析或跳过上游 SSE 数据块:', dataStr);
          }
        }
      }
    },
    flush(controller) {
      // 流结束时，发送最终的 [DONE] 块
      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });
}

/**
 * 转换非流式响应
 * @param {string} fullBody - 从上游获取的完整响应体文本
 * @param {string} requestId - 本次请求的唯一 ID
 * @param {string} model - 使用的模型名称
 * @returns {object} - OpenAI 格式的完整响应
 */
function transformNonStreamResponse(fullBody, requestId, model) {
    let fullContent = '';
    const lines = fullBody.split('\n');
    for (const line of lines) {
        if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
                const data = JSON.parse(dataStr);
                const deltaContent = data?.choices?.[0]?.delta?.content;
                if (deltaContent) {
                    fullContent += deltaContent;
                }
            } catch (e) {
                // 忽略
            }
        }
    }

    return {
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: fullContent,
            },
            finish_reason: "stop",
        }],
        usage: {
            prompt_tokens: 0, // 无法精确计算，设为0
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}


/**
 * 辅助函数，为响应头添加 CORS 策略
 * @param {object} headers - 现有的响应头
 * @returns {object} - 包含 CORS 头的新对象
 */
function corsHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// --- [第四部分: 开发者驾驶舱 UI] ---
/**
 * 处理对根路径的请求，返回一个功能丰富的 HTML UI
 * @param {Request} request - 传入的请求对象
 * @returns {Response} - 包含完整 UI 的 HTML 响应
 */
function handleUI(request) {
  const origin = new URL(request.url).origin;
  // 使用模板字符串嵌入完整的 HTML, CSS, 和 JS
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.PROJECT_NAME} - 开发者驾驶舱</title>
    <style>
      /* --- 全局样式与主题 --- */
      :root {
        --bg-color: #121212;
        --sidebar-bg: #1E1E1E;
        --main-bg: #121212;
        --border-color: #333333;
        --text-color: #E0E0E0;
        --text-secondary: #888888;
        --primary-color: #FFBF00; /* 琥珀色 */
        --primary-hover: #FFD700;
        --input-bg: #2A2A2A;
        --error-color: #CF6679;
        --success-color: #66BB6A;
        --font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
        --font-mono: 'Fira Code', 'Consolas', 'Monaco', monospace;
      }
      * { box-sizing: border-box; }
      body {
        font-family: var(--font-family);
        margin: 0;
        background-color: var(--bg-color);
        color: var(--text-color);
        font-size: 14px;
        display: flex;
        height: 100vh;
        overflow: hidden;
      }
      /* --- 骨架屏样式 --- */
      .skeleton {
        background-color: #2a2a2a;
        background-image: linear-gradient(90deg, #2a2a2a, #3a3a3a, #2a2a2a);
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s infinite;
        border-radius: 4px;
      }
      @keyframes skeleton-loading {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    </style>
</head>
<body>
    <!-- 主布局自定义元素 -->
    <main-layout></main-layout>

    <!-- 模板定义 -->
    <template id="main-layout-template">
      <style>
        .layout { display: flex; width: 100%; height: 100vh; }
        .sidebar { width: 380px; flex-shrink: 0; background-color: var(--sidebar-bg); border-right: 1px solid var(--border-color); padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
        .main-content { flex-grow: 1; display: flex; flex-direction: column; padding: 20px; overflow: hidden; }
        .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 15px; margin-bottom: 15px; border-bottom: 1px solid var(--border-color); }
        .header h1 { margin: 0; font-size: 20px; }
        .header .version { font-size: 12px; color: var(--text-secondary); margin-left: 8px; }
        .collapsible-section { margin-top: 20px; }
        .collapsible-section summary { cursor: pointer; font-weight: bold; margin-bottom: 10px; list-style-type: '⚙️'; padding-left: 8px; }
        .collapsible-section[open] summary { list-style-type: '⚙️'; }
        @media (max-width: 768px) {
          .layout { flex-direction: column; }
          .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border-color); }
        }
      </style>
      <div class="layout">
        <aside class="sidebar">
          <header class="header">
            <h1>${CONFIG.PROJECT_NAME}<span class="version">v${CONFIG.PROJECT_VERSION}</span></h1>
            <status-indicator></status-indicator>
          </header>
          <info-panel></info-panel>
          <details class="collapsible-section" open>
            <summary> 主流客户端集成指南</summary>
            <client-guides></client-guides>
          </details>
        </aside>
        <main class="main-content">
          <live-terminal></live-terminal>
        </main>
      </div>
    </template>

    <template id="status-indicator-template">
      <style>
        .indicator { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; transition: background-color: 0.3s; }
        .dot.grey { background-color: #555; }
        .dot.yellow { background-color: #FFBF00; animation: pulse 2s infinite; }
        .dot.green { background-color: var(--success-color); }
        .dot.red { background-color: var(--error-color); }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 191, 0, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(255, 191, 0, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 191, 0, 0); } }
      </style>
      <div class="indicator">
        <div id="status-dot" class="dot grey"></div>
        <span id="status-text">正在初始化...</span>
      </div>
    </template>

    <template id="info-panel-template">
      <style>
        .panel { display: flex; flex-direction: column; gap: 12px; }
        .info-item { display: flex; flex-direction: column; }
        .info-item label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .info-value { background-color: var(--input-bg); padding: 8px 12px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px; color: var(--primary-color); display: flex; align-items: center; justify-content: space-between; word-break: break-all; }
        .info-value.password { -webkit-text-security: disc; }
        .info-value.visible { -webkit-text-security: none; }
        .actions { display: flex; gap: 8px; }
        .icon-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; }
        .icon-btn:hover { color: var(--text-color); }
        .icon-btn svg { width: 16px; height: 16px; }
        .skeleton { height: 34px; }
      </style>
      <div class="panel">
        <div class="info-item">
          <label>API 端点 (Endpoint)</label>
          <div id="api-url" class="info-value skeleton"></div>
        </div>
        <div class="info-item">
          <label>API 密钥 (Master Key)</label>
          <div id="api-key" class="info-value password skeleton"></div>
        </div>
        <div class="info-item">
          <label>默认模型 (Default Model)</label>
          <div id="default-model" class="info-value skeleton"></div>
        </div>
      </div>
    </template>

    <template id="client-guides-template">
       <style>
        .tabs { display: flex; border-bottom: 1px solid var(--border-color); }
        .tab { padding: 8px 12px; cursor: pointer; border: none; background: none; color: var(--text-secondary); font-size: 13px; }
        .tab.active { color: var(--primary-color); border-bottom: 2px solid var(--primary-color); font-weight: bold; }
        .content { padding: 15px 0; }
        pre { background-color: var(--input-bg); padding: 12px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-all; position: relative; }
        .copy-code-btn { position: absolute; top: 8px; right: 8px; background: #444; border: 1px solid #555; color: #ccc; border-radius: 4px; cursor: pointer; font-size: 10px; padding: 2px 6px; }
        .copy-code-btn:hover { background: #555; }
        p { font-size: 13px; line-height: 1.5; }
       </style>
       <div>
         <div class="tabs"></div>
         <div class="content"></div>
       </div>
    </template>

    <template id="live-terminal-template">
      <style>
        .terminal { display: flex; flex-direction: column; height: 100%; background-color: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
        .output-window { flex-grow: 1; padding: 15px; overflow-y: auto; font-size: 14px; line-height: 1.6; }
        .output-window p { margin: 0 0 1em 0; }
        .output-window pre { background-color: #0d0d0d; padding: 1em; border-radius: 4px; white-space: pre-wrap; font-family: var(--font-mono); }
        .output-window .message { margin-bottom: 1em; }
        .output-window .message.user { color: var(--primary-color); font-weight: bold; }
        .output-window .message.assistant { color: var(--text-color); white-space: pre-wrap; }
        .output-window .message.error { color: var(--error-color); }
        .input-area { border-top: 1px solid var(--border-color); padding: 15px; display: flex; gap: 10px; align-items: flex-end; }
        textarea { flex-grow: 1; background-color: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-color); padding: 10px; font-family: var(--font-family); font-size: 14px; resize: none; min-height: 40px; max-height: 200px; }
        .send-btn { background-color: var(--primary-color); color: #121212; border: none; border-radius: 4px; padding: 0 15px; height: 40px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s; }
        .send-btn:hover { background-color: var(--primary-hover); }
        .send-btn:disabled { background-color: #555; cursor: not-allowed; }
        .send-btn.cancel svg { width: 24px; height: 24px; }
        .send-btn svg { width: 20px; height: 20px; }
        .placeholder { color: var(--text-secondary); }
      </style>
      <div class="terminal">
        <div class="output-window">
          <p class="placeholder">实时交互终端已就绪。输入指令开始测试...</p>
        </div>
        <div class="input-area">
          <textarea id="prompt-input" rows="1" placeholder="输入您的指令..."></textarea>
          <button id="send-btn" class="send-btn" title="发送">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l3.239-1.281a.75.75 0 000-1.39L4.23 6.28a.75.75 0 00-.95-.545L1.865 3.45a.75.75 0 00.95-.826l.002-.007.002-.006zm.002 14.422a.75.75 0 00.95.826l1.415-2.28a.75.75 0 00-.545-.95l-3.239-1.28a.75.75 0 00-1.39 0l-1.28 3.239a.75.75 0 00.544.95l4.95 1.414zM12.75 8.5a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z"/></svg>
          </button>
        </div>
      </div>
    </template>

    <script>
      // --- [第五部分: 客户端逻辑 (Developer Cockpit JS)] ---

      // --- 配置占位符 (由 Worker 动态注入) ---
      const CLIENT_CONFIG = {
          WORKER_ORIGIN: '${origin}',
          API_MASTER_KEY: '${CONFIG.API_MASTER_KEY}',
          DEFAULT_MODEL: '${CONFIG.DEFAULT_MODEL}',
          MODEL_LIST_STRING: '${CONFIG.MODELS.join(', ')}',
          CUSTOM_MODELS_STRING: '${CONFIG.MODELS.map(m => `+${m}`).join(',')}',
      };

      // --- 状态机 ---
      const AppState = {
        INITIALIZING: 'INITIALIZING',
        HEALTH_CHECKING: 'HEALTH_CHECKING',
        READY: 'READY',
        REQUESTING: 'REQUESTING',
        STREAMING: 'STREAMING',
        ERROR: 'ERROR',
      };
      let currentState = AppState.INITIALIZING;
      let abortController = null;

      // --- 基础组件 ---
      class BaseComponent extends HTMLElement {
        constructor(templateId) {
          super();
          this.attachShadow({ mode: 'open' });
          const template = document.getElementById(templateId);
          if (template) {
            this.shadowRoot.appendChild(template.content.cloneNode(true));
          }
        }
      }

      // --- 自定义元素定义 ---

      // 1. 主布局
      class MainLayout extends BaseComponent {
        constructor() { super('main-layout-template'); }
      }
      customElements.define('main-layout', MainLayout);

      // 2. 状态指示器
      class StatusIndicator extends BaseComponent {
        constructor() {
          super('status-indicator-template');
          this.dot = this.shadowRoot.getElementById('status-dot');
          this.text = this.shadowRoot.getElementById('status-text');
        }
        setState(state, message) {
          this.dot.className = 'dot'; // Reset
          switch (state) {
            case 'checking': this.dot.classList.add('yellow'); break;
            case 'ok': this.dot.classList.add('green'); break;
            case 'error': this.dot.classList.add('red'); break;
            default: this.dot.classList.add('grey');
          }
          this.text.textContent = message;
        }
      }
      customElements.define('status-indicator', StatusIndicator);

      // 3. 信息面板
      class InfoPanel extends BaseComponent {
        constructor() {
          super('info-panel-template');
          this.apiUrlEl = this.shadowRoot.getElementById('api-url');
          this.apiKeyEl = this.shadowRoot.getElementById('api-key');
          this.defaultModelEl = this.shadowRoot.getElementById('default-model');
        }
        connectedCallback() {
          this.render();
        }
        render() {
          const apiUrl = CLIENT_CONFIG.WORKER_ORIGIN + '/v1';
          const apiKey = CLIENT_CONFIG.API_MASTER_KEY;
          const defaultModel = CLIENT_CONFIG.DEFAULT_MODEL;

          this.populateField(this.apiUrlEl, apiUrl);
          this.populateField(this.apiKeyEl, apiKey, true);
          this.populateField(this.defaultModelEl, defaultModel);
        }
        populateField(element, value, isPassword = false) {
            element.classList.remove('skeleton');
            let content = '<span>' + value + '</span>' +
                '<div class="actions">' +
                    (isPassword ? '<button class="icon-btn" data-action="toggle-visibility" title="切换可见性">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.18l.88-1.473a1.65 1.65 0 012.899 0l.88 1.473a1.65 1.65 0 010 1.18l-.88 1.473a1.65 1.65 0 01-2.899 0l-.88-1.473zM18.45 10.59a1.651 1.651 0 010-1.18l.88-1.473a1.65 1.65 0 012.899 0l.88 1.473a1.65 1.65 0 010 1.18l-.88 1.473a1.65 1.65 0 01-2.899 0l-.88-1.473zM10 17a1.651 1.651 0 01-1.18 0l-1.473-.88a1.65 1.65 0 010-2.899l1.473-.88a1.651 1.651 0 011.18 0l1.473.88a1.65 1.65 0 010 2.899l-1.473.88a1.651 1.651 0 01-1.18 0z" clip-rule="evenodd" /></svg>' +
                    '</button>' : '') +
                    '<button class="icon-btn" data-action="copy" title="复制">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.121A1.5 1.5 0 0117 6.621V16.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 16.5v-13z" /><path d="M5 6.5A1.5 1.5 0 016.5 5h3.879a1.5 1.5 0 011.06.44l3.122 3.121A1.5 1.5 0 0115 9.621V14.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 015 14.5v-8z" /></svg>' +
                    '</button>' +
                '</div>';
            element.innerHTML = content;
            element.querySelector('[data-action="copy"]').addEventListener('click', () => navigator.clipboard.writeText(value));
            if (isPassword) {
                element.querySelector('[data-action="toggle-visibility"]').addEventListener('click', () => element.classList.toggle('visible'));
            }
        }
      }
      customElements.define('info-panel', InfoPanel);

      // 4. 客户端集成指南
      class ClientGuides extends BaseComponent {
        constructor() {
          super('client-guides-template');
          this.tabsContainer = this.shadowRoot.querySelector('.tabs');
          this.contentContainer = this.shadowRoot.querySelector('.content');
        }
        connectedCallback() {
          const guides = {
            'cURL': this.getCurlGuide(),
            'Python': this.getPythonGuide(),
            'LobeChat': this.getLobeChatGuide(),
            'Next-Web': this.getNextWebGuide(),
          };

          Object.keys(guides).forEach((name, index) => {
            const tab = document.createElement('button');
            tab.className = 'tab';
            tab.textContent = name;
            if (index === 0) tab.classList.add('active');
            tab.addEventListener('click', () => this.switchTab(name, guides));
            this.tabsContainer.appendChild(tab);
          });
          this.switchTab(Object.keys(guides)[0], guides);
        }
        switchTab(name, guides) {
          this.tabsContainer.querySelector('.active')?.classList.remove('active');
          this.tabsContainer.querySelector('button:nth-child(' + (Object.keys(guides).indexOf(name) + 1) + ')').classList.add('active');
          this.contentContainer.innerHTML = guides[name];
          this.contentContainer.querySelector('.copy-code-btn')?.addEventListener('click', (e) => {
              const code = e.target.closest('pre').querySelector('code').innerText;
              navigator.clipboard.writeText(code);
              const btn = e.target;
              btn.textContent = '已复制!';
              setTimeout(() => { btn.textContent = '复制'; }, 2000);
          });
        }

        getCurlGuide() {
            return \`<p>在您的终端中运行以下命令:</p><pre><button class="copy-code-btn">复制</button><code>curl --location '\${CLIENT_CONFIG.WORKER_ORIGIN}/v1/chat/completions' \\\\
--header 'Content-Type: application/json' \\\\
--header 'Authorization: Bearer \${CLIENT_CONFIG.API_MASTER_KEY}' \\\\
--data '{
    "model": "\${CLIENT_CONFIG.DEFAULT_MODEL}",
    "messages": [
        {
            "role": "user",
            "content": "你好，你是什么模型？"
        }
    ],
    "stream": true
}'</code></pre>\`;
        }
        getPythonGuide() {
            return \`<p>使用 OpenAI Python 库:</p><pre><button class="copy-code-btn">复制</button><code>import openai

client = openai.OpenAI(
    api_key="\${CLIENT_CONFIG.API_MASTER_KEY}",
    base_url="\${CLIENT_CONFIG.WORKER_ORIGIN}/v1"
)

stream = client.chat.completions.create(
    model="\${CLIENT_CONFIG.DEFAULT_MODEL}",
    messages=[{"role": "user", "content": "你好"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")</code></pre>\`;
        }
        getLobeChatGuide() {
            return \`<p>在 LobeChat 设置中，找到 "语言模型" -> "OpenAI" 设置:</p><pre><button class="copy-code-btn">复制</button><code>API Key: \${CLIENT_CONFIG.API_MASTER_KEY}
API 地址: \${CLIENT_CONFIG.WORKER_ORIGIN}/v1
模型列表: \${CLIENT_CONFIG.MODEL_LIST_STRING}</code></pre>\`;
        }
        getNextWebGuide() {
            return \`<p>在 ChatGPT-Next-Web 部署时，设置以下环境变量:</p><pre><button class="copy-code-btn">复制</button><code>CODE=\${CLIENT_CONFIG.API_MASTER_KEY}
BASE_URL=\${CLIENT_CONFIG.WORKER_ORIGIN}
CUSTOM_MODELS=\${CLIENT_CONFIG.CUSTOM_MODELS_STRING}</code></pre>\`;
        }
      }
      customElements.define('client-guides', ClientGuides);

      // 5. 实时终端
      class LiveTerminal extends BaseComponent {
        constructor() {
          super('live-terminal-template');
          this.outputWindow = this.shadowRoot.querySelector('.output-window');
          this.promptInput = this.shadowRoot.getElementById('prompt-input');
          this.sendBtn = this.shadowRoot.getElementById('send-btn');
          this.sendIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l3.239-1.281a.75.75 0 000-1.39L4.23 6.28a.75.75 0 00-.95-.545L1.865 3.45a.75.75 0 00.95-.826l.002-.007.002-.006zm.002 14.422a.75.75 0 00.95.826l1.415-2.28a.75.75 0 00-.545-.95l-3.239-1.28a.75.75 0 00-1.39 0l-1.28 3.239a.75.75 0 00.544.95l4.95 1.414zM12.75 8.5a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z"/></svg>';
          this.cancelIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" /></svg>';
        }
        connectedCallback() {
          this.sendBtn.addEventListener('click', () => this.handleSend());
          this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              this.handleSend();
            }
          });
          this.promptInput.addEventListener('input', this.autoResize);
        }
        autoResize(event) {
            const textarea = event.target;
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }
        handleSend() {
          if (currentState === AppState.REQUESTING || currentState === AppState.STREAMING) {
            this.cancelStream();
          } else {
            this.startStream();
          }
        }
        addMessage(role, content) {
            const messageEl = document.createElement('div');
            messageEl.className = 'message ' + role;
            messageEl.textContent = content;
            
            const placeholder = this.outputWindow.querySelector('.placeholder');
            if (placeholder) placeholder.remove();

            this.outputWindow.appendChild(messageEl);
            this.outputWindow.scrollTop = this.outputWindow.scrollHeight;
            return messageEl;
        }
        async startStream() {
          const prompt = this.promptInput.value.trim();
          if (!prompt) return;

          setState(AppState.REQUESTING);
          this.addMessage('user', prompt);
          const assistantMessageEl = this.addMessage('assistant', '▍');

          abortController = new AbortController();
          try {
            const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY,
              },
              body: JSON.stringify({
                model: CLIENT_CONFIG.DEFAULT_MODEL,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
              }),
              signal: abortController.signal,
            });

            if (!response.ok) {
              const err = await response.json();
              throw new Error(err.error.message);
            }

            setState(AppState.STREAMING);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\\n').filter(line => line.startsWith('data:'));

              for (const line of lines) {
                const dataStr = line.substring(5).trim();
                if (dataStr === '[DONE]') {
                    assistantMessageEl.textContent = fullContent; // 移除光标
                    break;
                }
                try {
                  const data = JSON.parse(dataStr);
                  const delta = data.choices[0].delta.content;
                  if (delta) {
                    fullContent += delta;
                    assistantMessageEl.textContent = fullContent + '▍';
                    this.outputWindow.scrollTop = this.outputWindow.scrollHeight;
                  }
                } catch (e) {}
              }
            }
          } catch (e) {
            if (e.name !== 'AbortError') {
              this.addMessage('error', '请求失败: ' + e.message);
              setState(AppState.ERROR);
            }
          } finally {
            if (currentState !== AppState.ERROR) {
              setState(AppState.READY);
            }
          }
        }
        cancelStream() {
          if (abortController) {
            abortController.abort();
            abortController = null;
          }
          setState(AppState.READY);
        }
        updateButtonState(state) {
            if (state === AppState.REQUESTING || state === AppState.STREAMING) {
                this.sendBtn.innerHTML = this.cancelIcon;
                this.sendBtn.title = "取消";
                this.sendBtn.classList.add('cancel');
                this.sendBtn.disabled = false;
            } else {
                this.sendBtn.innerHTML = this.sendIcon;
                this.sendBtn.title = "发送";
                this.sendBtn.classList.remove('cancel');
                this.sendBtn.disabled = state !== AppState.READY;
            }
        }
      }
      customElements.define('live-terminal', LiveTerminal);

      // --- 全局状态管理与初始化 ---
      function setState(newState) {
        currentState = newState;
        const terminal = document.querySelector('main-layout')?.shadowRoot.querySelector('live-terminal');
        if (terminal) {
            terminal.updateButtonState(newState);
        }
      }

      async function performHealthCheck() {
        const statusIndicator = document.querySelector('main-layout')?.shadowRoot.querySelector('status-indicator');
        if (!statusIndicator) return;
        
        statusIndicator.setState('checking', '检查上游服务...');
        try {
          const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/models', {
            headers: { 'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY }
          });
          if (response.ok) {
            statusIndicator.setState('ok', '服务运行正常');
            setState(AppState.READY);
          } else {
            const err = await response.json();
            throw new Error(err.error.message);
          }
        } catch (e) {
          statusIndicator.setState('error', '健康检查失败');
          setState(AppState.ERROR);
        }
      }

      // --- 应用启动 ---
      document.addEventListener('DOMContentLoaded', () => {
        setState(AppState.INITIALIZING);
        customElements.whenDefined('main-layout').then(() => {
            performHealthCheck();
        });
      });

    </script>
</body>
</html>`;

  // 返回最终的 HTML 响应
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 启用 Brotli 压缩
      'Content-Encoding': 'br'
    },
  });
}
