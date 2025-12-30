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
 * Recursively remove unwanted fields from an object or array
 */
function removeUnwantedFields(obj) {
  const unwantedFields = ['signature', 'cache_control'];

  if (Array.isArray(obj)) {
    return obj.map(item => removeUnwantedFields(item));
  } else if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const key in obj) {
      if (!unwantedFields.includes(key)) {
        cleaned[key] = removeUnwantedFields(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
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

  // Extract endpoint from filename and convert to path format
  const endpointMatch = filename.match(/api\.anthropic\.com_(.+)\.txt$/);
  const endpoint = endpointMatch ? '/' + endpointMatch[1].replace(/_/g, '/') : 'unknown';

  // Parse HTTP headers and body
  const lines = content.split('\n');
  let bodyStartIndex = lines.findIndex(line => line.trim() === '');

  let data = {};
  if (bodyStartIndex !== -1 && bodyStartIndex < lines.length - 1) {
    const bodyContent = lines.slice(bodyStartIndex + 1).join('\n');
    try {
      data = JSON.parse(bodyContent);

      // Remove unwanted fields from all data
      data = removeUnwantedFields(data);

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
    .container { max-width: 1800px; margin: 0 auto; }
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
      align-items: flex-start;
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

    /* Split view layout */
    .split-view {
      display: flex;
      gap: 20px;
      margin-top: 20px;
    }
    .blocks-panel {
      flex: 2;
      min-width: 0;
    }
    .detail-panel {
      flex: 3;
      background: #252526;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 15px;
      position: sticky;
      top: 20px;
      max-height: calc(100vh - 40px);
      overflow: auto;
    }
    .detail-panel h3 {
      margin-top: 0;
      color: #4ec9b0;
    }

    /* JSON Viewer custom styles */
    andypf-json-viewer {
      font-size: 13px;
      line-height: 1.6;
      align-items: flex-start !important;
    }

    /* Try to apply white-space to string values - Method 1: Global CSS */
    andypf-json-viewer * {
      white-space: pre-wrap !important;
      align-items: flex-start !important;
    }

    /* Try to pierce Shadow DOM - Method 2: CSS parts */
    andypf-json-viewer::part(string-value) {
      white-space: pre-wrap;
    }

    /* Additional attempts for different possible selectors */
    andypf-json-viewer::part(value) {
      white-space: pre-wrap;
    }

    andypf-json-viewer::part(string) {
      white-space: pre-wrap;
    }

    /* Block visualization */
    .blocks-container {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 15px;
      align-items: flex-start;
    }
    .block {
      display: flex;
      align-items: flex-start;
      padding: 10px 15px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.9em;
      border: 2px solid transparent;
    }
    .block:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    }
    .block.selected {
      border-color: #fff;
      box-shadow: 0 0 10px rgba(255,255,255,0.3);
    }
    .block.system {
      background: #7c3aed;
      color: #fff;
    }
    .block.tool {
      background: #f59e0b;
      color: #000;
    }
    .block.user {
      background: #3b82f6;
      color: #fff;
    }
    .block.assistant {
      background: #10b981;
      color: #fff;
    }
    .block.tool_use {
      background: #ec4899;
      color: #fff;
    }
    .block.tool_result {
      background: #8b5cf6;
      color: #fff;
    }
    .block.continued {
      opacity: 0.2;
      position: relative;
    }
    .block.continued::after {
      content: '↻';
      position: absolute;
      top: 2px;
      right: 5px;
      font-size: 0.8em;
      opacity: 0.6;
    }

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

    async function handleExampleChange() {
      const select = document.getElementById('example-select');
      const exampleId = select.value;
      const detailContainer = document.getElementById('example-detail-container');

      if (!exampleId) {
        detailContainer.innerHTML = '';
        return;
      }

      detailContainer.innerHTML = '<div class="loading">Loading...</div>';

      try {
        const response = await fetch('/api/example/' + exampleId);
        const data = await response.json();

        renderExampleDetail(exampleId, data, detailContainer);
      } catch (error) {
        detailContainer.innerHTML = '<div class="loading">Loading failed: ' + error.message + '</div>';
      }
    }

    let currentSelectedBlock = null;
    let blockDataStore = {};

    // Simple hash function
    function simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36).substring(0, 6);
    }

    function formatBlockType(type) {
      const typeMap = {
        'system': 'System',
        'tool': 'Tool',
        'user': 'User',
        'assistant': 'Assistant',
        'tool_use': 'ToolUse',
        'tool_result': 'ToolResult'
      };
      return typeMap[type] || type;
    }

    function renderDetailContent(content) {
      const viewerId = 'json-viewer-' + Math.random().toString(36).substr(2, 9);
      const html = '<div id="' + viewerId + '" style="margin-top: 10px;"></div>';

      setTimeout(() => {
        const container = document.getElementById(viewerId);
        if (container) {
          const viewer = document.createElement('andypf-json-viewer');
          viewer.data = content;
          viewer.expanded = true;
          viewer.indent = 2;
          viewer.theme = 'monokai';
          viewer.showDataTypes = true;
          viewer.showToolbar = false;
          viewer.expandIconType = 'arrow';
          viewer.showCopy = false;
          viewer.showSize = false;
          container.appendChild(viewer);

          // Try to inject CSS into Shadow DOM for newline handling and vertical alignment
          setTimeout(() => {
            if (viewer.shadowRoot) {
              const style = document.createElement('style');
              style.textContent = '.string-value, .value, span[class*=\\'string\\'] { white-space: pre-wrap !important; } .key-value, [class*=\\'key-value\\'], div, span { align-items: flex-start !important; }';
              viewer.shadowRoot.appendChild(style);
            }
          }, 100);
        }
      }, 0);

      return html;
    }

    function showBlockDetail(exampleId, blockId) {
      const detailPanel = document.getElementById('detail-panel-' + exampleId);
      const blockData = blockDataStore[exampleId + '-' + blockId];

      if (!blockData) return;

      // Determine display ID based on block type
      let displayId = '';
      if (blockData.type === 'tool' && blockData.content.name) {
        displayId = blockData.content.name;
      } else if (blockData.type === 'tool_use' && blockData.content.id && blockData.content.id.startsWith('toolu_')) {
        const idPart = blockData.content.id.substring(6);
        displayId = idPart.substring(0, 4).toUpperCase();
      } else if (blockData.type === 'tool_result' && blockData.content.tool_use_id && blockData.content.tool_use_id.startsWith('toolu_')) {
        const idPart = blockData.content.tool_use_id.substring(6);
        displayId = idPart.substring(0, 4).toUpperCase();
      } else {
        const hash = simpleHash(JSON.stringify(blockData.content));
        displayId = hash.substring(0, 4).toUpperCase();
      }

      // Update selected state
      const allBlocks = document.querySelectorAll('.block');
      allBlocks.forEach(b => b.classList.remove('selected'));
      const blockElement = document.getElementById('block-' + exampleId + '-' + blockId);
      if (blockElement) {
        blockElement.classList.add('selected');
      }

      // Show detail panel
      detailPanel.innerHTML = '<h3>' + formatBlockType(blockData.type) + '-' + displayId + '</h3>' + renderDetailContent(blockData.content);
    }

    // Generate hash sequence for a request trace to compare with previous requests
    function generateBlockHashSequence(trace) {
      const hashes = [];

      if (trace.type !== 'request') return hashes;

      // System blocks
      if (trace.data.system) {
        const systemItems = Array.isArray(trace.data.system) ? trace.data.system : [trace.data.system];
        systemItems.forEach(item => {
          hashes.push(simpleHash(JSON.stringify(item)));
        });
      }

      // Tool blocks
      if (trace.data.tools && trace.data.tools.length > 0) {
        trace.data.tools.forEach(tool => {
          hashes.push(simpleHash(JSON.stringify(tool)));
        });
      }

      // Message blocks
      if (trace.data.messages) {
        trace.data.messages.forEach(msg => {
          const isContentArray = Array.isArray(msg.content);
          if (isContentArray && msg.content.length > 0) {
            msg.content.forEach(contentItem => {
              hashes.push(simpleHash(JSON.stringify(contentItem)));
            });
          } else {
            hashes.push(simpleHash(JSON.stringify(msg)));
          }
        });
      }

      return hashes;
    }

    // Compare two hash sequences and return the number of matching prefix blocks
    function countMatchingPrefixBlocks(prevHashes, currentHashes) {
      let count = 0;
      const minLength = Math.min(prevHashes.length, currentHashes.length);

      for (let i = 0; i < minLength; i++) {
        if (prevHashes[i] === currentHashes[i]) {
          count++;
        } else {
          break; // Stop at first mismatch
        }
      }

      return count;
    }

    function renderBlocks(exampleId, trace, traceIdx, previousTrace) {
      let html = '';
      let blockIdx = 0;
      let continuedBlockCount = 0;

      // Count system blocks in current trace
      let systemBlockCount = 0;
      if (trace.type === 'request' && trace.data.system) {
        const systemItems = Array.isArray(trace.data.system) ? trace.data.system : [trace.data.system];
        systemBlockCount = systemItems.length;
      }

      // Calculate how many blocks are continued from previous request
      if (previousTrace && previousTrace.type === 'request') {
        const prevHashes = generateBlockHashSequence(previousTrace);
        const currentHashes = generateBlockHashSequence(trace);
        const matchingCount = countMatchingPrefixBlocks(prevHashes, currentHashes);

        // Only apply continuation style if more than just system blocks match
        if (matchingCount > systemBlockCount) {
          continuedBlockCount = matchingCount;
        }
      }

      if (trace.type === 'request') {
        // First render system blocks if exists
        if (trace.data.system) {
          const systemData = trace.data.system;

          // Check if system is an array or a single item
          const systemItems = Array.isArray(systemData) ? systemData : [systemData];

          systemItems.forEach(item => {
            const hash = simpleHash(JSON.stringify(item));
            const displayId = hash.substring(0, 4).toUpperCase();
            const blockId = 'trace' + traceIdx + '-block' + blockIdx;

            blockDataStore[exampleId + '-' + blockId] = {
              type: 'system',
              content: item
            };

            const continuedClass = blockIdx < continuedBlockCount ? ' continued' : '';
            html += '<div id="block-' + exampleId + '-' + blockId + '" class="block system' + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
            html += 'System-' + displayId;
            html += '</div>';
            blockIdx++;
          });
        }

        // Then render each tool as a separate block
        if (trace.data.tools && trace.data.tools.length > 0) {
          trace.data.tools.forEach(tool => {
            const toolName = tool.name || 'unknown';
            const blockId = 'trace' + traceIdx + '-block' + blockIdx;

            blockDataStore[exampleId + '-' + blockId] = {
              type: 'tool',
              content: tool
            };

            const continuedClass = blockIdx < continuedBlockCount ? ' continued' : '';
            html += '<div id="block-' + exampleId + '-' + blockId + '" class="block tool' + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
            html += 'Tool-' + toolName;
            html += '</div>';
            blockIdx++;
          });
        }

        // Finally render messages in their original order (user and assistant alternating)
        if (trace.data.messages) {
          trace.data.messages.forEach((msg) => {
            const role = msg.role || 'unknown';

            // Check if content is an array (multiple content blocks)
            const isContentArray = Array.isArray(msg.content);

            if (isContentArray && msg.content.length > 0) {
              // Split into multiple blocks, one for each content element
              msg.content.forEach((contentItem, contentIdx) => {
                const blockId = 'trace' + traceIdx + '-block' + blockIdx;

                // Determine block type based on content item type
                let blockType = role;
                let displayId = '';

                if (contentItem.type === 'tool_use') {
                  blockType = 'tool_use';
                  // Extract last 4 chars after 'toolu_' from id
                  if (contentItem.id && contentItem.id.startsWith('toolu_')) {
                    const idPart = contentItem.id.substring(6); // Remove 'toolu_'
                    displayId = idPart.substring(0, 4).toUpperCase();
                  }
                } else if (contentItem.type === 'tool_result') {
                  blockType = 'tool_result';
                  // Extract last 4 chars after 'toolu_' from tool_use_id
                  if (contentItem.tool_use_id && contentItem.tool_use_id.startsWith('toolu_')) {
                    const idPart = contentItem.tool_use_id.substring(6); // Remove 'toolu_'
                    displayId = idPart.substring(0, 4).toUpperCase();
                  }
                } else {
                  // For other types, use first 4 chars of hash in uppercase
                  const hash = simpleHash(JSON.stringify(contentItem));
                  displayId = hash.substring(0, 4).toUpperCase();
                }

                blockDataStore[exampleId + '-' + blockId] = {
                  type: blockType,
                  content: contentItem
                };

                const continuedClass = blockIdx < continuedBlockCount ? ' continued' : '';
                html += '<div id="block-' + exampleId + '-' + blockId + '" class="block ' + blockType + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
                html += formatBlockType(blockType) + '-' + displayId;
                html += '</div>';
                blockIdx++;
              });
            } else {
              // Single content block (string or single object)
              const hash = simpleHash(JSON.stringify(msg));
              const displayId = hash.substring(0, 4).toUpperCase();
              const blockId = 'trace' + traceIdx + '-block' + blockIdx;

              blockDataStore[exampleId + '-' + blockId] = {
                type: role,
                content: msg
              };

              const continuedClass = blockIdx < continuedBlockCount ? ' continued' : '';
              html += '<div id="block-' + exampleId + '-' + blockId + '" class="block ' + role + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
              html += formatBlockType(role) + '-' + displayId;
              html += '</div>';
              blockIdx++;
            }
          });
        }
      }

      return html;
    }

    function renderExampleDetail(exampleId, data, detailContainer) {
      const detailDiv = detailContainer;

      // Clear old block data for this example
      Object.keys(blockDataStore).forEach(key => {
        if (key.startsWith(exampleId + '-')) {
          delete blockDataStore[key];
        }
      });

      let html = '<div class="split-view">';
      html += '<div class="blocks-panel">';
      html += '<div class="timeline">';

      data.llmTraces.forEach((trace, idx) => {
        const eventClass = trace.type === 'response' ? 'event response' : 'event';
        const metaInfo = trace.type === 'request' && trace.data.model
          ? trace.data.model + ' | ' + trace.endpoint
          : trace.endpoint;
        html += '<div class="' + eventClass + '">';
        html += '<div class="event-header">';
        html += '<span class="event-title">[' + trace.timestamp + '] ' + trace.type.toUpperCase() + '</span>';
        html += '<span class="event-meta">' + metaInfo + '</span>';
        html += '</div>';

        // Render blocks for requests
        if (trace.type === 'request') {
          // Find the previous request trace (not response)
          let previousRequestTrace = null;
          for (let i = idx - 1; i >= 0; i--) {
            if (data.llmTraces[i].type === 'request') {
              previousRequestTrace = data.llmTraces[i];
              break;
            }
          }

          html += '<div class="blocks-container">';
          html += renderBlocks(exampleId, trace, idx, previousRequestTrace);
          html += '</div>';
        } else {
          // For responses, show raw JSON on click
          html += '<div onclick="toggleDetail(\\'' + exampleId + '-' + idx + '\\')" style="cursor: pointer; margin-top: 10px; color: #858585;">';
          html += 'Click to view response details ▼';
          html += '</div>';
          html += '<div id="detail-' + exampleId + '-' + idx + '" class="detail">';
          html += '<pre>' + JSON.stringify(trace.data, null, 2) + '</pre>';
          html += '</div>';
        }

        html += '</div>';
      });

      html += '</div>';
      html += '</div>';
      html += '<div id="detail-panel-' + exampleId + '" class="detail-panel">';
      html += '<h3>Select a block to view details</h3>';
      html += '<p style="color: #858585;">Click a block on the left to view detailed content</p>';
      html += '</div>';
      html += '</div>';

      detailDiv.innerHTML = html;
    }
  `;
}

function renderExampleSelector(examples) {
  let html = '<div class="example-selector" style="margin: 20px 0;">';
  html += '<label for="example-select" style="display: block; margin-bottom: 10px; color: #4ec9b0; font-weight: bold;">Select Example:</label>';
  html += '<select id="example-select" onchange="handleExampleChange()" style="width: 100%; padding: 10px; background: #2d2d30; color: #d4d4d4; border: 1px solid #3e3e42; border-radius: 4px; font-family: inherit; font-size: 14px;">';
  html += '<option value="">-- Choose an example --</option>';

  examples.forEach(ex => {
    html += `<option value="${ex.id}">${ex.id}</option>`;
  });

  html += '</select>';
  html += '</div>';
  html += '<div id="example-detail-container" style="margin-top: 20px;"></div>';

  return html;
}

function generateHTML(examples) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🔍 Claude Code Execution Viewer</title>
      <script src="https://pfau-software.de/json-viewer/dist/iife/index.js"></script>
      <style>${getCSS()}</style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 Claude Code Execution Viewer</h1>
        <p style="color: #858585; margin-bottom: 30px;">
          Interactive visualization tool for viewing Claude Code execution traces
        </p>
        <div id="examples">
          ${renderExampleSelector(examples)}
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
