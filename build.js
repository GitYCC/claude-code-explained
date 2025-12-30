const fs = require('fs');
const path = require('path');
const { scanExamples, parseExample, getCSS, getClientJS } = require('./view.js');

/**
 * Build static site from view.js dynamic content
 */

const OUTPUT_DIR = path.join(__dirname, 'dist');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Generate client-side JavaScript with embedded data (static version)
function getClientJSStatic(examplesData) {
  // Get the core client JS from view.js and extract the reusable functions
  const dynamicClientJS = getClientJS();

  // Extract the core functions (everything except handleExampleChange)
  // We'll replace the fetch-based loader with embedded data loader
  const coreJS = dynamicClientJS
    .replace(/async function handleExampleChange\(\) \{[\s\S]*?\n    \}/, '') // Remove dynamic loader
    .trim();

  return `
    // Embedded example data
    const EXAMPLES_DATA = ${JSON.stringify(examplesData, null, 2)};

    // Static data loader (replaces fetch-based loader)
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

      renderExampleDetail(exampleId, data, detailDiv);
    }

${coreJS}
  `;
}

// Render examples list with buttons (static version)
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

// Generate complete HTML (static version)
function generateHTMLStatic(examples, examplesData) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔍 Claude Code Execution Viewer (Static)</title>
  <script src="https://pfau-software.de/json-viewer/dist/iife/index.js"></script>
  <style>${getCSS()}</style>
</head>
<body>
  <div class="container">
    <h1>🔍 Claude Code Execution Viewer</h1>
    <p style="color: #858585; margin-bottom: 30px;">
      Interactive visualization tool for viewing Claude Code execution traces (Static Build)
    </p>
    <div id="examples">
      ${renderExamplesList(examples)}
    </div>
  </div>
  <script>${getClientJSStatic(examplesData)}</script>
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
  const html = generateHTMLStatic(examples, examplesData);

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
