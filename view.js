const fs = require('fs');
const path = require('path');

/**
 * Scan examples directory and return list of examples
 */
function scanExamples() {
  const examplesDir = path.join(__dirname, 'examples');

  if (!fs.existsSync(examplesDir)) {
    return [];
  }

  const entries = fs.readdirSync(examplesDir, { withFileTypes: true });

  const examples = entries
    .filter(entry => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map(entry => ({
      id: entry.name,
      name: entry.name.replace(/^\d+_/, '').replace(/-/g, ' ')
    }));

  return examples;
}

/**
 * Parse a single LLM trace file (Request or Response)
 */
function parseLLMFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);

  // Extract timestamp from filename: [1885] Request - ...
  const timestampMatch = filename.match(/\[(\d+)\]/);
  const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : 0;

  // Determine type (request or response)
  const type = filename.toLowerCase().includes('request') ? 'request' : 'response';

  // Extract endpoint from filename
  const endpointMatch = filename.match(/api\.anthropic\.com_(.+)\.txt$/);
  const endpoint = endpointMatch ? endpointMatch[1] : 'unknown';

  // Parse HTTP headers and body
  const lines = content.split('\n');
  let bodyStartIndex = lines.findIndex(line => line.trim() === '');

  let data = {};
  if (bodyStartIndex !== -1 && bodyStartIndex < lines.length - 1) {
    const bodyContent = lines.slice(bodyStartIndex + 1).join('\n');
    try {
      data = JSON.parse(bodyContent);

      // For requests, only keep important fields
      if (type === 'request') {
        const filteredData = {};
        const importantFields = ['model', 'messages', 'tools', 'system'];

        importantFields.forEach(field => {
          if (data[field] !== undefined) {
            filteredData[field] = data[field];
          }
        });

        data = filteredData;
      }
    } catch (e) {
      // If JSON parse fails, store as raw text
      data = { raw: bodyContent };
    }
  }

  return {
    timestamp,
    type,
    endpoint,
    data,
    filePath
  };
}

/**
 * Parse a complete example directory
 */
function parseExample(exampleId) {
  const exampleDir = path.join(__dirname, 'examples', exampleId);
  const llmDir = path.join(exampleDir, 'llm');

  if (!fs.existsSync(llmDir)) {
    return {
      id: exampleId,
      llmTraces: []
    };
  }

  const llmFiles = fs.readdirSync(llmDir)
    .filter(f => f.endsWith('.txt'))
    .map(f => path.join(llmDir, f));

  const llmTraces = llmFiles
    .map(file => parseLLMFile(file))
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    id: exampleId,
    llmTraces
  };
}

// ============ HTML Generation Functions ============

function getCSS() {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      margin: 0;
      padding: 20px;
      background: #1e1e1e;
      color: #d4d4d4;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      color: #4ec9b0;
      border-bottom: 2px solid #4ec9b0;
      padding-bottom: 10px;
    }
    .example {
      background: #252526;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 20px;
      margin: 20px 0;
    }
    .example h2 {
      color: #dcdcaa;
      margin-top: 0;
    }
    .timeline { margin: 20px 0; }
    .event {
      background: #2d2d30;
      border-left: 3px solid #007acc;
      padding: 12px;
      margin: 8px 0;
      cursor: pointer;
      transition: background 0.2s;
    }
    .event:hover { background: #3e3e42; }
    .event.response { border-left-color: #4ec9b0; }
    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .event-title {
      font-weight: bold;
      color: #569cd6;
    }
    .event-meta {
      font-size: 0.9em;
      color: #858585;
    }
    .detail {
      display: none;
      background: #1e1e1e;
      padding: 15px;
      margin-top: 10px;
      border-radius: 4px;
      max-height: 500px;
      overflow: auto;
    }
    .detail.show { display: block; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: #ce9178;
    }
    .stats {
      background: #252526;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 15px;
      margin: 20px 0;
    }
    .stats h3 {
      margin-top: 0;
      color: #4ec9b0;
    }
    .stat-item {
      padding: 5px 0;
      color: #d4d4d4;
    }
    .loading {
      text-align: center;
      padding: 20px;
      color: #858585;
    }
  `;
}

function getClientJS() {
  return `
    function toggleDetail(id) {
      const detail = document.getElementById('detail-' + id);
      detail.classList.toggle('show');
    }

    async function loadExampleDetail(exampleId) {
      const detailDiv = document.getElementById('example-detail-' + exampleId);

      if (detailDiv.innerHTML && detailDiv.style.display === 'block') {
        detailDiv.style.display = 'none';
        return;
      }

      detailDiv.innerHTML = '<div class="loading">載入中...</div>';
      detailDiv.style.display = 'block';

      try {
        const response = await fetch('/api/example/' + exampleId);
        const data = await response.json();

        renderExampleDetail(exampleId, data);
      } catch (error) {
        detailDiv.innerHTML = '<div class="loading">載入失敗: ' + error.message + '</div>';
      }
    }

    function renderExampleDetail(exampleId, data) {
      const detailDiv = document.getElementById('example-detail-' + exampleId);

      const stats = {
        totalTraces: data.llmTraces.length,
        requests: data.llmTraces.filter(t => t.type === 'request').length,
        responses: data.llmTraces.filter(t => t.type === 'response').length
      };

      let html = '<div class="stats">';
      html += '<h3>📊 統計資訊</h3>';
      html += '<div class="stat-item">總追蹤數: ' + stats.totalTraces + '</div>';
      html += '<div class="stat-item">請求數: ' + stats.requests + '</div>';
      html += '<div class="stat-item">回應數: ' + stats.responses + '</div>';
      html += '</div>';

      html += '<div class="timeline">';
      data.llmTraces.forEach((trace, idx) => {
        const eventClass = trace.type === 'response' ? 'event response' : 'event';
        html += '<div class="' + eventClass + '" onclick="toggleDetail(\\'' + exampleId + '-' + idx + '\\')">';
        html += '<div class="event-header">';
        html += '<span class="event-title">[' + trace.timestamp + '] ' + trace.type.toUpperCase() + '</span>';
        html += '<span class="event-meta">' + trace.endpoint + '</span>';
        html += '</div>';
        html += '<div id="detail-' + exampleId + '-' + idx + '" class="detail">';
        html += '<pre>' + JSON.stringify(trace.data, null, 2) + '</pre>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';

      detailDiv.innerHTML = html;
    }
  `;
}

function renderExamplesList(examples) {
  return examples.map(ex => `
    <div class="example">
      <h2>📁 ${ex.name}</h2>
      <p style="color: #858585;">ID: ${ex.id}</p>
      <button onclick="loadExampleDetail('${ex.id}')"
              style="background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">
        查看時間軸
      </button>
      <div id="example-detail-${ex.id}" style="display: none; margin-top: 20px;"></div>
    </div>
  `).join('');
}

function generateHTML(examples) {
  return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🔍 Claude Code Execution Viewer</title>
      <style>${getCSS()}</style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 Claude Code Execution Viewer</h1>
        <p style="color: #858585; margin-bottom: 30px;">
          互動式視覺化工具，用於查看 Claude Code 的執行追蹤記錄
        </p>
        <div id="examples">
          ${renderExamplesList(examples)}
        </div>
      </div>
      <script>${getClientJS()}</script>
    </body>
    </html>
  `;
}

// ============ Express Server ============

function startServer() {
  const express = require('express');
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Main page - dynamically generated HTML
  app.get('/', (req, res) => {
    const examples = scanExamples();
    const html = generateHTML(examples);
    res.send(html);
  });

  // API endpoint - get example detail
  app.get('/api/example/:id', (req, res) => {
    try {
      const exampleData = parseExample(req.params.id);
      res.json(exampleData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`📂 Serving examples from: ${path.join(__dirname, 'examples')}`);

    // Auto open browser on macOS
    if (process.platform === 'darwin') {
      require('child_process').exec(`open http://localhost:${PORT}`);
    }
  });
}

// Export functions for testing
module.exports = {
  scanExamples,
  parseLLMFile,
  parseExample
};

// Only run server if executed directly (not during testing)
if (require.main === module) {
  startServer();
}
