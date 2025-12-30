const fs = require('fs');
const path = require('path');
const { scanExamples, parseExample, getCSS, getClientJS, renderExampleSelector } = require('./view.js');

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
  // Get the core client JS from view.js
  const dynamicClientJS = getClientJS();

  // Replace the try-catch fetch block with embedded data access
  const staticJS = dynamicClientJS.replace(
    /try \{[\s\S]*?const response = await fetch\([^)]+\);[\s\S]*?const data = await response\.json\(\);[\s\S]*?renderExampleDetail\(exampleId, data, detailContainer\);[\s\S]*?\} catch \(error\) \{[\s\S]*?\}/,
    `// Get data from embedded EXAMPLES_DATA instead of fetching
      const data = EXAMPLES_DATA[exampleId];
      if (!data) {
        detailContainer.innerHTML = '<div class="loading">Example not found</div>';
        return;
      }

      renderExampleDetail(exampleId, data, detailContainer);`
  );

  return `
    // Embedded example data
    const EXAMPLES_DATA = ${JSON.stringify(examplesData, null, 2)};

${staticJS}
  `;
}

// Generate complete HTML (static version)
function generateHTMLStatic(examples, examplesData) {
  return `<!DOCTYPE html>
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
