const fs = require('fs');
const path = require('path');
const { scanExamples, parseExample } = require('./view.js');

/**
 * Build static site from view.js dynamic content
 */

const OUTPUT_DIR = path.join(__dirname, 'dist');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get CSS styles
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

// Generate client-side JavaScript with embedded data
function getClientJS(examplesData) {
  return `
    // Embedded example data
    const EXAMPLES_DATA = ${JSON.stringify(examplesData, null, 2)};

    function toggleDetail(id) {
      const detail = document.getElementById('detail-' + id);
      detail.classList.toggle('show');
    }

    function loadExampleDetail(exampleId) {
      const detailDiv = document.getElementById('example-detail-' + exampleId);

      if (detailDiv.innerHTML && detailDiv.style.display === 'block') {
        detailDiv.style.display = 'none';
        return;
      }

      detailDiv.innerHTML = '<div class="loading">Loading...</div>';
      detailDiv.style.display = 'block';

      // Get data from embedded EXAMPLES_DATA
      const data = EXAMPLES_DATA[exampleId];
      if (!data) {
        detailDiv.innerHTML = '<div class="loading">Example not found</div>';
        return;
      }

      renderExampleDetail(exampleId, data);
    }

    function renderExampleDetail(exampleId, data) {
      const detailDiv = document.getElementById('example-detail-' + exampleId);

      const stats = {
        totalTraces: data.llmTraces.length,
        requests: data.llmTraces.filter(t => t.type === 'request').length,
        responses: data.llmTraces.filter(t => t.type === 'response').length
      };

      let html = '<div class="stats">';
      html += '<h3>📊 Statistics</h3>';
      html += '<div class="stat-item">Total Traces: ' + stats.totalTraces + '</div>';
      html += '<div class="stat-item">Requests: ' + stats.requests + '</div>';
      html += '<div class="stat-item">Responses: ' + stats.responses + '</div>';
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

// Render examples list
function renderExamplesList(examples) {
  return examples.map(ex => `
    <div class="example">
      <h2>📁 ${ex.name}</h2>
      <p style="color: #858585;">ID: ${ex.id}</p>
      <button onclick="loadExampleDetail('${ex.id}')"
              style="background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">
        View Timeline
      </button>
      <div id="example-detail-${ex.id}" style="display: none; margin-top: 20px;"></div>
    </div>
  `).join('');
}

// Generate complete HTML
function generateHTML(examples, examplesData) {
  return `<!DOCTYPE html>
<html lang="en">
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
      Interactive visualization tool for viewing Claude Code execution traces
    </p>
    <div id="examples">
      ${renderExamplesList(examples)}
    </div>
  </div>
  <script>${getClientJS(examplesData)}</script>
</body>
</html>
`;
}

// Main build function
function build() {
  console.log('🔨 Building static site...');

  // Scan and parse all examples
  const examples = scanExamples();
  console.log(`📂 Found ${examples.length} example(s)`);

  // Parse all example data
  const examplesData = {};
  examples.forEach(ex => {
    console.log(`   Processing: ${ex.id}`);
    examplesData[ex.id] = parseExample(ex.id);
  });

  // Generate HTML
  const html = generateHTML(examples, examplesData);

  // Write to output directory
  const outputPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log(`✅ Build complete!`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Size: ${(html.length / 1024).toFixed(2)} KB`);
}

// Run build
if (require.main === module) {
  build();
}

module.exports = { build };
