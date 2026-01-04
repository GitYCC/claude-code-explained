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
 * Load system prompt templates from prompts directory (recursive)
 */
function loadSystemPrompts() {
  const promptsDir = path.join(__dirname, 'prompts');

  if (!fs.existsSync(promptsDir)) {
    return {};
  }

  const prompts = {};

  // Recursively scan subdirectories (system, user, etc.)
  const scanDir = (dir, subdir = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        scanDir(fullPath, entry.name);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Extract name from filename: analyze-topic.md -> Analyze-Topic
        let name = entry.name.replace(/\.md$/, '');
        name = name.split('-').map(word =>
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join('-');

        // Construct relative path for GitHub URL
        const relPath = subdir ? `${subdir}/${entry.name}` : entry.name;

        prompts[name] = {
          content: content,
          file: entry.name,
          githubUrl: `https://github.com/GitYCC/claude-code-explained/blob/main/prompts/${relPath}`
        };
      }
    }
  };

  scanDir(promptsDir);
  return prompts;
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
 * Parse SSE (Server-Sent Events) streaming response
 */
function parseSSEResponse(bodyContent) {
  const lines = bodyContent.split('\n');
  const events = [];
  let currentEvent = null;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      if (currentEvent) {
        events.push(currentEvent);
      }
      currentEvent = { type: line.substring(7).trim(), data: null };
    } else if (line.startsWith('data: ')) {
      if (currentEvent) {
        const dataStr = line.substring(6).trim();
        try {
          currentEvent.data = JSON.parse(dataStr);
        } catch (e) {
          currentEvent.data = dataStr;
        }
      }
    } else if (line.trim() === '' && currentEvent) {
      events.push(currentEvent);
      currentEvent = null;
    }
  }

  if (currentEvent) {
    events.push(currentEvent);
  }

  // Merge streaming events into final message
  let message = {
    model: '',
    id: '',
    type: 'message',
    role: 'assistant',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {}
  };

  const contentBlocks = {};

  for (const event of events) {
    if (!event.data) continue;

    if (event.type === 'message_start') {
      // Initialize message from message_start
      const msg = event.data.message;
      message.model = msg.model;
      message.id = msg.id;
      message.usage = msg.usage;
    } else if (event.type === 'content_block_start') {
      // Start a new content block
      const index = event.data.index;
      contentBlocks[index] = { ...event.data.content_block };
    } else if (event.type === 'content_block_delta') {
      // Append delta to content block
      const index = event.data.index;
      const delta = event.data.delta;

      if (!contentBlocks[index]) {
        contentBlocks[index] = { type: delta.type.replace('_delta', '') };
      }

      // Merge delta content
      if (delta.type === 'text_delta') {
        contentBlocks[index].text = (contentBlocks[index].text || '') + delta.text;
      } else if (delta.type === 'thinking_delta') {
        contentBlocks[index].thinking = (contentBlocks[index].thinking || '') + delta.thinking;
      } else if (delta.type === 'input_json_delta') {
        // Handle input: if it's an object (from content_block_start), convert to empty string
        if (typeof contentBlocks[index].input === 'object') {
          contentBlocks[index].input = '';
        }
        contentBlocks[index].input = (contentBlocks[index].input || '') + delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      // Content block is complete
      // Parse input JSON string to object if needed
      const index = event.data.index;
      if (contentBlocks[index] && typeof contentBlocks[index].input === 'string' && contentBlocks[index].input.trim() !== '') {
        try {
          contentBlocks[index].input = JSON.parse(contentBlocks[index].input);
        } catch (e) {
          // Keep as string if parsing fails (but don't warn for empty strings)
          if (contentBlocks[index].input.trim() !== '') {
            console.warn('Failed to parse tool input JSON for block', index, ':', e.message);
          }
        }
      } else if (contentBlocks[index] && typeof contentBlocks[index].input === 'string' && contentBlocks[index].input.trim() === '') {
        // Empty string input should be empty object
        contentBlocks[index].input = {};
      }
    } else if (event.type === 'message_delta') {
      // Update message-level fields
      if (event.data.delta) {
        if (event.data.delta.stop_reason) {
          message.stop_reason = event.data.delta.stop_reason;
        }
        if (event.data.delta.stop_sequence) {
          message.stop_sequence = event.data.delta.stop_sequence;
        }
      }
      if (event.data.usage) {
        message.usage.output_tokens = event.data.usage.output_tokens;
      }
    } else if (event.type === 'message_stop') {
      // Message is complete
      // No additional action needed
    }
  }

  // Convert contentBlocks to array
  const contentIndexes = Object.keys(contentBlocks).map(k => parseInt(k)).sort((a, b) => a - b);
  message.content = contentIndexes.map(idx => contentBlocks[idx]);

  return message;
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
  // Match both .json files and files without extension
  const endpointMatch = filename.match(/api\.anthropic\.com_(.+?)(?:\.json)?$/);
  const endpoint = endpointMatch ? '/' + endpointMatch[1].replace(/_/g, '/') : 'unknown';

  // Determine if file is JSON or SSE based on file extension
  const isJsonFile = filename.endsWith('.json');

  let data = {};
  try {
    if (isJsonFile) {
      // Parse JSON directly
      data = JSON.parse(content);
    } else {
      // Parse SSE streaming format
      data = parseSSEResponse(content);
    }

    // Remove unwanted fields from all data
    data = removeUnwantedFields(data);

    // For requests, only keep important fields
    if (type === 'request') {
      const filteredData = {};
      const importantFields = ['model', 'messages', 'tools', 'system', 'thinking'];

      importantFields.forEach(field => {
        if (data[field] !== undefined) {
          filteredData[field] = data[field];
        }
      });

      data = filteredData;
    }

    // For responses, only keep content if it exists
    if (type === 'response' && data.content !== undefined) {
      data = { content: data.content };
    }
  } catch (e) {
    // If parse fails, store as raw text
    data = { raw: content };
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

  if (!fs.existsSync(exampleDir)) {
    return {
      id: exampleId,
      llmTraces: [],
      cliLog: null,
      levels: { main: [], 'second-rank': [] }
    };
  }

  // Read CLI log file if exists (examples/XX_name.txt)
  const cliLogPath = path.join(__dirname, 'examples', `${exampleId}.txt`);
  let cliLog = null;
  if (fs.existsSync(cliLogPath)) {
    cliLog = fs.readFileSync(cliLogPath, 'utf-8');
  }

  // No longer using level JSON files - levels are determined by system prompt content

  // Read all files from example directory that match API trace pattern
  const llmFiles = fs.readdirSync(exampleDir)
    .filter(f => {
      // Match both .json files and files without extension that contain API trace pattern
      return f.includes('api.anthropic.com') && !fs.statSync(path.join(exampleDir, f)).isDirectory();
    })
    .map(f => path.join(exampleDir, f));

  const llmTraces = llmFiles
    .map(file => parseLLMFile(file))
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    id: exampleId,
    llmTraces,
    cliLog
  };
}

// ============ HTML Generation Functions ============

/**
 * Escape HTML special characters to prevent XSS and rendering issues
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

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
    .timeline {
      margin: 20px 0;
    }
    .swimlane-headers {
      display: flex;
      gap: 20px;
      margin-bottom: 0;
    }
    .swimlane-header {
      flex: 1;
      background: #1e1e1e;
      border: 2px solid #4ec9b0;
      border-radius: 4px 4px 0 0;
      padding: 12px;
      font-weight: bold;
      color: #4ec9b0;
      text-align: center;
      font-size: 12px;
    }
    .timeline-content {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .timeline-row {
      display: flex;
      gap: 20px;
    }
    .timeline-cell {
      flex: 1;
      border-left: 2px solid #3e3e42;
      border-right: 2px solid #3e3e42;
      padding: 0 10px;
    }
    .timeline-cell:first-child {
      border-left: 2px solid #3e3e42;
    }
    .timeline-cell:last-child {
      border-right: 2px solid #3e3e42;
    }
    .timeline-row:last-child .timeline-cell {
      border-bottom: 2px solid #3e3e42;
      border-radius: 0 0 4px 4px;
      padding-bottom: 10px;
    }
    .event {
      background: #2d2d30;
      border-left: 3px solid #007acc;
      padding: 12px;
      margin: 8px 0;
      cursor: pointer;
      transition: background 0.2s;
    }
    .event:hover { background: #3e3e42; }
    .event.response {
      border-left-color: #4ec9b0;
      margin-top: 0;
      margin-bottom: 30px;
    }
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
      flex: 1.5;
      min-width: 0;
    }
    .detail-panel {
      flex: 1;
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
    .collapsed-blocks {
      background: #3e3e42;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 8px 12px;
      margin: 8px 0;
      cursor: pointer;
      transition: background 0.2s;
      color: #858585;
      font-size: 0.9em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .collapsed-blocks:hover {
      background: #4a4a4e;
    }
    .collapsed-blocks .arrow {
      transition: transform 0.2s;
      display: inline-block;
    }
    .collapsed-blocks.expanded .arrow {
      transform: rotate(90deg);
    }
    .collapsed-content {
      display: none;
    }
    .collapsed-content.show {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
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
    .cli-log {
      background: #0c0c0c;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 20px;
      margin: 20px 0;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #d4d4d4;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .cli-log h3 {
      margin-top: 0;
      color: #4ec9b0;
      border-bottom: 1px solid #3e3e42;
      padding-bottom: 10px;
    }

    /* ============ Mobile Responsive Styles ============ */

    /* Backdrop overlay for mobile drawer */
    .detail-panel-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 998;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .detail-panel-backdrop.show {
      display: block;
      opacity: 1;
    }

    /* Mobile breakpoint: < 768px */
    @media (max-width: 767px) {
      /* Stack layout vertically */
      .split-view {
        flex-direction: column;
      }

      .blocks-panel {
        flex: 1;
        width: 100%;
      }

      /* Transform detail-panel into bottom drawer */
      .detail-panel {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        max-height: 0; /* Hidden by default */
        overflow: hidden;
        z-index: 999;
        border-radius: 16px 16px 0 0;
        border: none;
        border-top: 2px solid #4ec9b0;
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
        transition: max-height 0.3s ease, padding 0.3s ease;
        padding: 0;
      }

      /* Drawer open state */
      .detail-panel.open {
        max-height: 80vh;
        padding: 20px 15px;
        overflow: auto;
      }

      /* Drag indicator (top handle bar) */
      .detail-panel::before {
        content: '';
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 40px;
        height: 4px;
        background: #858585;
        border-radius: 2px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .detail-panel.open::before {
        opacity: 1;
      }

      /* Adjust spacing for drag indicator */
      .detail-panel.open h3:first-child {
        margin-top: 20px;
      }

      /* Swimlane responsive scaling */
      .swimlane-headers {
        gap: 4px;
      }

      .swimlane-header {
        padding: 6px 4px;
        font-size: 9px;
      }

      .timeline-row {
        gap: 4px;
      }

      .timeline-cell {
        padding: 0 3px;
      }

      .event {
        padding: 6px;
        margin: 4px 0;
        font-size: 11px;
      }

      .event-header {
        flex-direction: column;
        gap: 2px;
      }

      .event-title {
        font-size: 11px;
      }

      .event-meta {
        font-size: 0.75em;
      }

      .blocks-container {
        gap: 4px;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
      }

      .block {
        padding: 6px 10px;
        font-size: 0.8em;
        max-width: calc(100% - 4px);
        min-width: 0;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
    }
  `;
}

function getClientJS() {
  return `
    /**
     * Escape HTML special characters to prevent XSS and rendering issues
     */
    function escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, char => map[char]);
    }

    function toggleDetail(id) {
      const detail = document.getElementById('detail-' + id);
      detail.classList.toggle('show');
    }

    function toggleCollapsedBlocks(id) {
      const collapseHeader = document.getElementById('collapse-header-' + id);
      const collapseContent = document.getElementById('collapse-content-' + id);
      collapseHeader.classList.toggle('expanded');
      collapseContent.classList.toggle('show');
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
    let systemPromptsCache = {};

    /**
     * Normalize text for comparison: trim and collapse multiple whitespaces
     */
    function normalizeText(text) {
      return text.trim().replace(/\\s+/g, ' ');
    }

    /**
     * Escape special regex characters
     */
    function escapeRegex(str) {
      // Escape all special regex characters
      return str.replace(/[\\\\^$.*+?()\\[\\]{}|]/g, '\\\\$&');
    }

    /**
     * Convert template with {{placeholders}} to a regex pattern
     * Placeholders like {{WORKING_DIRECTORY}} become .*? (non-greedy match)
     */
    function templateToRegex(template) {
      let pattern = '';
      let i = 0;
      let lastWasPlaceholder = false;

      while (i < template.length) {
        // Check for placeholder start
        if (template[i] === '{' && template[i+1] === '{') {
          // Find placeholder end
          let endIdx = template.indexOf('}}', i + 2);
          if (endIdx !== -1) {
            // Replace placeholder with wildcard
            // Make following single space optional to handle cases where
            // placeholder replacement removes trailing whitespace
            pattern += '.*?';
            i = endIdx + 2;
            lastWasPlaceholder = true;

            // If next character is a single space, make it optional
            // This handles normalized newlines that become spaces
            if (i < template.length && template[i] === ' ') {
              pattern += ' ?';
              i++;
              lastWasPlaceholder = false;
            }
            continue;
          }
        }

        // Regular character - escape it
        pattern += escapeRegex(template[i]);
        i++;
        lastWasPlaceholder = false;
      }

      // If template ends with placeholder, allow any content after
      // Otherwise require exact match to end
      const endPattern = lastWasPlaceholder ? '' : '$';
      return new RegExp('^' + pattern + endPattern, 's');
    }

    /**
     * Extract signature phrases from template (non-placeholder parts)
     */
    function extractSignatures(template) {
      const signatures = [];
      let i = 0;
      let currentPhrase = '';

      while (i < template.length) {
        if (template[i] === '{' && template[i+1] === '{') {
          // Save current phrase if it's meaningful
          if (currentPhrase.trim().length > 10) {
            signatures.push(currentPhrase.trim());
          }
          currentPhrase = '';

          // Skip placeholder
          let endIdx = template.indexOf('}}', i + 2);
          if (endIdx !== -1) {
            i = endIdx + 2;
            continue;
          }
        }

        currentPhrase += template[i];
        i++;
      }

      // Save final phrase
      if (currentPhrase.trim().length > 10) {
        signatures.push(currentPhrase.trim());
      }

      return signatures;
    }

    /**
     * Determine trace level based on system prompt content
     * Returns 'main' if contains Analyze-Topic or Interactive-Cli
     * Returns 'second' if contains Explore-Agent
     * Returns 'third' otherwise
     */
    function determineTraceLevel(trace, systemPrompts) {
      if (trace.type !== 'request' || !trace.data.system) {
        return 'third';
      }

      const systemData = trace.data.system;
      const systemItems = Array.isArray(systemData) ? systemData : [systemData];

      for (const item of systemItems) {
        const matchResult = matchSystemPrompt(item, systemPrompts);

        if (matchResult) {
          const matchedPromptName = matchResult.name;
          // Check if matched prompt name contains specific keywords
          if (matchedPromptName.includes('Analyze-Topic') || matchedPromptName.includes('Interactive-Cli')) {
            return 'main';
          }
          if (matchedPromptName.includes('-Agent')) {
            return 'second';
          }
        }
      }

      return 'third';
    }

    /**
     * Try to match system content against known prompt templates
     * Returns {name, githubUrl} if matched, null otherwise
     */
    function matchSystemPrompt(systemContent, systemPrompts) {
      // Extract text from system content
      let contentText = '';
      if (typeof systemContent === 'string') {
        contentText = systemContent;
      } else if (systemContent && typeof systemContent === 'object') {
        // Handle {type: "text", text: "..."} structure
        contentText = systemContent.text || JSON.stringify(systemContent);
      } else {
        contentText = JSON.stringify(systemContent);
      }

      const normalizedContent = normalizeText(contentText);

      for (const [name, promptData] of Object.entries(systemPrompts)) {
        // Handle both old format (string) and new format (object with content)
        const templateContent = typeof promptData === 'string' ? promptData : promptData.content;
        const normalizedTemplate = normalizeText(templateContent);

        // Strategy 1: Try exact regex match first
        const regex = templateToRegex(normalizedTemplate);
        if (regex.test(normalizedContent)) {
          return {
            name: name,
            githubUrl: typeof promptData === 'object' ? promptData.githubUrl : null
          };
        }

        // Strategy 2: Try signature matching (for templates with many placeholders)
        const signatures = extractSignatures(normalizedTemplate);
        if (signatures.length >= 3) {
          // Check if all signatures appear in content
          const allMatch = signatures.every(sig =>
            normalizedContent.includes(sig)
          );

          if (allMatch) {
            return {
              name: name,
              githubUrl: typeof promptData === 'object' ? promptData.githubUrl : null
            };
          }
        }
      }

      return null;
    }

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

    /**
     * Extract hashable content from a content item
     * For text-based content, extract the actual text rather than the whole object
     */
    function getHashableContent(contentItem) {
      if (typeof contentItem === 'string') {
        return contentItem;
      }

      if (contentItem && typeof contentItem === 'object') {
        // For text type, use the text field
        if (contentItem.type === 'text' && contentItem.text) {
          return contentItem.text;
        }
        // For thinking type, use the thinking field
        if (contentItem.type === 'thinking' && contentItem.thinking) {
          return contentItem.thinking;
        }
        // For tool_use and tool_result, use full object (need id/tool_use_id)
        // For other types, use full JSON
      }

      return JSON.stringify(contentItem);
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

    function formatModelName(modelName) {
      if (!modelName) return '';
      // Extract simple model name: claude-sonnet-4-5-20250929 -> Sonnet
      if (modelName.includes('sonnet')) return 'Sonnet';
      if (modelName.includes('haiku')) return 'Haiku';
      if (modelName.includes('opus')) return 'Opus';
      return modelName;
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

    /**
     * Check if current viewport is mobile (< 768px)
     */
    function isMobileView() {
      return window.innerWidth < 768;
    }

    /**
     * Open mobile drawer with backdrop
     */
    function openMobileDrawer(exampleId) {
      const detailPanel = document.getElementById('detail-panel-' + exampleId);
      let backdrop = document.getElementById('detail-panel-backdrop-' + exampleId);

      if (!detailPanel) return;

      // Create backdrop if not exists
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'detail-panel-backdrop-' + exampleId;
        backdrop.className = 'detail-panel-backdrop';
        backdrop.onclick = () => closeMobileDrawer(exampleId);
        document.body.appendChild(backdrop);
      }

      // Show backdrop and drawer (use RAF for smooth transition)
      requestAnimationFrame(() => {
        backdrop.classList.add('show');
        detailPanel.classList.add('open');
      });

      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
    }

    /**
     * Close mobile drawer
     */
    function closeMobileDrawer(exampleId) {
      const detailPanel = document.getElementById('detail-panel-' + exampleId);
      const backdrop = document.getElementById('detail-panel-backdrop-' + exampleId);

      if (detailPanel) {
        detailPanel.classList.remove('open');
      }

      if (backdrop) {
        backdrop.classList.remove('show');
      }

      // Restore body scroll
      document.body.style.overflow = '';
    }

    /**
     * Setup swipe-down gesture to close drawer
     */
    function setupDrawerSwipe(exampleId) {
      const detailPanel = document.getElementById('detail-panel-' + exampleId);
      if (!detailPanel) return;

      let startY = 0;
      let currentY = 0;

      detailPanel.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
      }, { passive: true });

      detailPanel.addEventListener('touchmove', (e) => {
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // Only allow swipe down when scrolled to top
        if (deltaY > 0 && detailPanel.scrollTop === 0) {
          e.preventDefault();
        }
      }, { passive: false });

      detailPanel.addEventListener('touchend', (e) => {
        const deltaY = currentY - startY;

        // Close if swiped down more than 100px from top
        if (deltaY > 100 && detailPanel.scrollTop === 0) {
          closeMobileDrawer(exampleId);
        }
      }, { passive: true });
    }

    function showBlockDetail(exampleId, blockId) {
      const detailPanel = document.getElementById('detail-panel-' + exampleId);
      const blockData = blockDataStore[exampleId + '-' + blockId];

      if (!blockData) return;

      // Use displayId from blockData if available
      let displayId = blockData.displayId || '';

      // Fallback: determine display ID based on block type (for backward compatibility)
      if (!displayId) {
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
      }

      // Update selected state
      const allBlocks = document.querySelectorAll('.block');
      allBlocks.forEach(b => b.classList.remove('selected'));
      const blockElement = document.getElementById('block-' + exampleId + '-' + blockId);
      if (blockElement) {
        blockElement.classList.add('selected');
      }

      // Show detail panel
      let titleHtml = '<h3>' + formatBlockType(blockData.type) + '/' + displayId;
      if (blockData.githubUrl) {
        titleHtml += ' <a href="' + blockData.githubUrl + '" target="_blank" style="font-size: 0.8em; color: #0969da; text-decoration: underline; margin-left: 8px; cursor: pointer;">View this Prompt on Github</a>';
      }
      titleHtml += '</h3>';
      detailPanel.innerHTML = titleHtml + renderDetailContent(blockData.content);

      // ========== Mobile drawer logic ==========
      if (isMobileView()) {
        openMobileDrawer(exampleId);
      }
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
              hashes.push(simpleHash(getHashableContent(contentItem)));
            });
          } else {
            hashes.push(simpleHash(getHashableContent(msg.content)));
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

    /**
     * Group consecutive continued blocks and generate final HTML
     * Only collapse continued blocks if they form a complete prefix (start from index 0)
     */
    function groupAndRenderBlocks(blocks) {
      let html = '';
      let i = 0;
      let collapseGroupId = 0;

      while (i < blocks.length) {
        if (blocks[i].isContinued) {
          // Start of a continued group
          const groupStart = i;
          while (i < blocks.length && blocks[i].isContinued) {
            i++;
          }
          const groupEnd = i;
          const groupSize = groupEnd - groupStart;

          // Only create collapsed block if this group starts from the beginning (complete prefix)
          if (groupStart === 0) {
            // Generate collapsed block (keep continued class for opacity)
            const collapseId = 'collapse-' + Date.now() + '-' + collapseGroupId++;
            html += '<div id="collapse-header-' + collapseId + '" class="collapsed-blocks" onclick="toggleCollapsedBlocks(\\'' + collapseId + '\\')">';
            html += '<span class="arrow">▶</span>';
            html += '<span>' + groupSize + ' continued from above</span>';
            html += '</div>';
            html += '<div id="collapse-content-' + collapseId + '" class="collapsed-content">';
            for (let j = groupStart; j < groupEnd; j++) {
              html += blocks[j].html;
            }
            html += '</div>';
          } else {
            // If not a complete prefix, render blocks normally and remove 'continued' class
            for (let j = groupStart; j < groupEnd; j++) {
              // Remove 'continued' class from HTML
              const blockHtml = blocks[j].html.replace(/ continued/g, '');
              html += blockHtml;
            }
          }
        } else {
          // Regular block
          html += blocks[i].html;
          i++;
        }
      }

      return html;
    }

    function renderBlocks(exampleId, trace, traceIdx, previousTrace, allTraces, currentLevel, traceLevels, systemPrompts) {
      const blocks = []; // Collect all blocks here
      let blockIdx = 0;
      let continuedBlockCount = 0;

      // Build toolUseMap from all previous traces including current
      const toolUseMap = {};
      if (allTraces) {
        for (let i = 0; i <= traceIdx; i++) {
          const t = allTraces[i];
          if (t.type === 'request' && t.data.messages) {
            t.data.messages.forEach(msg => {
              if (Array.isArray(msg.content)) {
                msg.content.forEach(item => {
                  if (item.type === 'tool_use' && item.id && item.name) {
                    toolUseMap[item.id] = item.name;
                  }
                });
              }
            });
          }
          // Also collect from response content
          if (t.type === 'response' && t.data.content) {
            t.data.content.forEach(item => {
              if (item.type === 'tool_use' && item.id && item.name) {
                toolUseMap[item.id] = item.name;
              }
              // Also collect server_tool_use
              if (item.type === 'server_tool_use' && item.id && item.name) {
                toolUseMap[item.id] = item.name;
              }
            });
          }
        }
      }

      // Collect all block hashes and tool_use ids from previous responses (for continuation detection)
      const previousResponseHashes = new Set();
      const previousResponseToolUseIds = new Set();
      if (trace.type === 'request' && allTraces) {
        for (let i = 0; i < traceIdx; i++) {
          const t = allTraces[i];
          if (t.type === 'response' && t.data.content) {
            t.data.content.forEach(item => {
              if (item.type === 'tool_use' && item.id) {
                previousResponseToolUseIds.add(item.id);
              } else if (item.type === 'server_tool_use' && item.id) {
                previousResponseToolUseIds.add(item.id);
              } else {
                const hash = simpleHash(getHashableContent(item));
                previousResponseHashes.add(hash);
              }
            });
          }
        }
      }

      // Count system blocks in current trace
      let systemBlockCount = 0;
      if (trace.type === 'request' && trace.data.system) {
        const systemItems = Array.isArray(trace.data.system) ? trace.data.system : [trace.data.system];
        systemBlockCount = systemItems.length;
      }

      // Calculate how many blocks are continued from previous request
      // Use level-based logic: main compares with previous main, second compares with previous second
      if (trace.type === 'request' && allTraces && traceLevels) {
        // Find the appropriate previous trace based on current level
        let compareWithTrace = null;

        if (currentLevel === 'main') {
          // For main level, find previous main request
          for (let i = traceIdx - 1; i >= 0; i--) {
            if (allTraces[i].type === 'request' && traceLevels[i] === 'main') {
              compareWithTrace = allTraces[i];
              break;
            }
          }
        } else if (currentLevel === 'second') {
          // For second level, find previous second request
          // But only if not interrupted by a main request
          for (let i = traceIdx - 1; i >= 0; i--) {
            const t = allTraces[i];
            if (t.type === 'request') {
              if (traceLevels[i] === 'main') {
                // Found a main request in between, stop searching
                break;
              } else if (traceLevels[i] === 'second') {
                // Found a second request
                compareWithTrace = t;
                break;
              }
            }
          }
        }
        // For third level or other levels, don't compare (no continuation style)

        if (compareWithTrace) {
          const prevHashes = generateBlockHashSequence(compareWithTrace);
          const currentHashes = generateBlockHashSequence(trace);
          const matchingCount = countMatchingPrefixBlocks(prevHashes, currentHashes);

          // Only apply continuation style if more than just system blocks match
          if (matchingCount > systemBlockCount) {
            continuedBlockCount = matchingCount;
          }
        }
      }

      if (trace.type === 'request') {
        // First render system blocks if exists
        if (trace.data.system) {
          const systemData = trace.data.system;

          // Check if system is an array or a single item
          const systemItems = Array.isArray(systemData) ? systemData : [systemData];

          systemItems.forEach(item => {
            // Try to match against known system prompts
            let displayId = '';
            let githubUrl = null;
            const prompts = systemPromptsCache[exampleId] || {};
            const matchResult = matchSystemPrompt(item, prompts);

            const itemHash = simpleHash(JSON.stringify(item));
            if (matchResult) {
              displayId = matchResult.name;
              githubUrl = matchResult.githubUrl;
            } else {
              displayId = itemHash.substring(0, 4).toUpperCase();
            }

            const blockId = 'trace' + traceIdx + '-block' + blockIdx;

            blockDataStore[exampleId + '-' + blockId] = {
              type: 'system',
              content: item,
              displayId: displayId,
              githubUrl: githubUrl
            };

            const isContinuedFromPrefix = blockIdx < continuedBlockCount;
            const isContinuedFromResponse = previousResponseHashes.has(itemHash);
            const isContinued = isContinuedFromPrefix || isContinuedFromResponse;
            const continuedClass = isContinued ? ' continued' : '';

            let blockHtml = '<div id="block-' + exampleId + '-' + blockId + '" class="block system' + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
            blockHtml += 'System/' + displayId;
            blockHtml += '</div>';

            blocks.push({ html: blockHtml, isContinued: isContinued });
            blockIdx++;
          });
        }

        // Then render each tool as a separate block
        if (trace.data.tools && trace.data.tools.length > 0) {
          trace.data.tools.forEach(tool => {
            const toolName = tool.name || 'unknown';
            const blockId = 'trace' + traceIdx + '-block' + blockIdx;

            // Generate GitHub URL for tool definition
            const githubUrl = 'https://github.com/GitYCC/claude-code-explained/blob/main/prompts/tool/' + toolName.toLowerCase().replace(/_/g, '-') + '.md';

            blockDataStore[exampleId + '-' + blockId] = {
              type: 'tool',
              content: tool,
              displayId: toolName,
              githubUrl: githubUrl
            };

            const toolHash = simpleHash(JSON.stringify(tool));
            const isContinuedFromPrefix = blockIdx < continuedBlockCount;
            const isContinuedFromResponse = previousResponseHashes.has(toolHash);
            const isContinued = isContinuedFromPrefix || isContinuedFromResponse;
            const continuedClass = isContinued ? ' continued' : '';

            let blockHtml = '<div id="block-' + exampleId + '-' + blockId + '" class="block tool' + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
            blockHtml += 'Tool/' + toolName;
            blockHtml += '</div>';

            blocks.push({ html: blockHtml, isContinued: isContinued });
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
                const contentHash = simpleHash(getHashableContent(contentItem));

                // Determine block type based on content item type
                let blockType = role;
                let displayId = '';
                let githubUrl = null;

                if (contentItem.type === 'tool_use') {
                  blockType = 'tool_use';
                  const toolName = contentItem.name || 'unknown';
                  // Extract last 4 chars after 'toolu_' from id
                  if (contentItem.id && contentItem.id.startsWith('toolu_')) {
                    const idPart = contentItem.id.substring(6); // Remove 'toolu_'
                    displayId = toolName + '-' + idPart.substring(0, 4).toUpperCase();
                  }
                } else if (contentItem.type === 'tool_result') {
                  blockType = 'tool_result';
                  const toolName = toolUseMap[contentItem.tool_use_id] || '';
                  // Extract last 4 chars after 'toolu_' from tool_use_id
                  if (contentItem.tool_use_id && contentItem.tool_use_id.startsWith('toolu_')) {
                    const idPart = contentItem.tool_use_id.substring(6); // Remove 'toolu_'
                    if (toolName) {
                      displayId = toolName + '-' + idPart.substring(0, 4).toUpperCase();
                    } else {
                      displayId = idPart.substring(0, 4).toUpperCase();
                    }
                  }
                } else if (contentItem.type === 'thinking') {
                  blockType = 'assistant';
                  displayId = 'Think-' + contentHash.substring(0, 4).toUpperCase();
                } else if (contentItem.type === 'text') {
                  blockType = role;
                  // Try to match user text content with prompt files
                  if (role === 'user' && contentItem.text) {
                    const prompts = systemPromptsCache[exampleId] || {};
                    const matchResult = matchSystemPrompt(contentItem, prompts);
                    if (matchResult) {
                      displayId = matchResult.name;
                      githubUrl = matchResult.githubUrl;
                    } else {
                      displayId = contentHash.substring(0, 4).toUpperCase();
                    }
                  } else {
                    displayId = contentHash.substring(0, 4).toUpperCase();
                  }
                } else {
                  // For other types, use first 4 chars of hash in uppercase
                  displayId = contentHash.substring(0, 4).toUpperCase();
                }

                blockDataStore[exampleId + '-' + blockId] = {
                  type: blockType,
                  content: contentItem,
                  displayId: displayId,
                  githubUrl: githubUrl
                };

                const isContinuedFromPrefix = blockIdx < continuedBlockCount;
                let isContinuedFromResponse = false;
                if (contentItem.type === 'tool_use' && contentItem.id) {
                  isContinuedFromResponse = previousResponseToolUseIds.has(contentItem.id);
                } else {
                  isContinuedFromResponse = previousResponseHashes.has(contentHash);
                }
                const isContinued = isContinuedFromPrefix || isContinuedFromResponse;
                const continuedClass = isContinued ? ' continued' : '';

                let blockHtml = '<div id="block-' + exampleId + '-' + blockId + '" class="block ' + blockType + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
                blockHtml += formatBlockType(blockType) + '/' + displayId;
                blockHtml += '</div>';

                blocks.push({ html: blockHtml, isContinued: isContinued });
                blockIdx++;
              });
            } else {
              // Single content block (string or single object)
              const msgHash = simpleHash(getHashableContent(msg.content));
              const displayId = msgHash.substring(0, 4).toUpperCase();
              const blockId = 'trace' + traceIdx + '-block' + blockIdx;

              blockDataStore[exampleId + '-' + blockId] = {
                type: role,
                content: msg,
                displayId: displayId
              };

              const isContinuedFromPrefix = blockIdx < continuedBlockCount;
              const isContinuedFromResponse = previousResponseHashes.has(msgHash);
              const isContinued = isContinuedFromPrefix || isContinuedFromResponse;
              const continuedClass = isContinued ? ' continued' : '';

              let blockHtml = '<div id="block-' + exampleId + '-' + blockId + '" class="block ' + role + continuedClass + '" onclick="showBlockDetail(\\'' + exampleId + '\\', \\'' + blockId + '\\')">';
              blockHtml += formatBlockType(role) + '/' + displayId;
              blockHtml += '</div>';

              blocks.push({ html: blockHtml, isContinued: isContinued });
              blockIdx++;
            }
          });
        }
      } else if (trace.type === 'response') {
        // Render response content blocks with merging of consecutive same-type blocks
        if (trace.data.content && Array.isArray(trace.data.content)) {
          // First, group consecutive blocks of the same type
          const groups = [];
          let currentGroup = null;

          trace.data.content.forEach((contentItem, contentIdx) => {
            let blockType = contentItem.type || 'text';

            // Normalize block types for grouping
            if (contentItem.type === 'text') {
              blockType = 'text';
            } else if (contentItem.type === 'thinking') {
              blockType = 'thinking';
            } else if (contentItem.type === 'tool_use') {
              blockType = 'tool_use';
            } else if (contentItem.type === 'server_tool_use') {
              blockType = 'server_tool_use';
            } else if (contentItem.type === 'web_search_tool_result') {
              blockType = 'web_search_tool_result';
            }

            // Don't merge tool_use blocks - each should be displayed separately
            if (blockType === 'tool_use' || blockType === 'server_tool_use' || blockType === 'web_search_tool_result') {
              // Create a new group for each tool block
              currentGroup = { type: blockType, items: [contentItem], startIdx: contentIdx };
              groups.push(currentGroup);
            } else if (!currentGroup || currentGroup.type !== blockType) {
              currentGroup = { type: blockType, items: [contentItem], startIdx: contentIdx };
              groups.push(currentGroup);
            } else {
              currentGroup.items.push(contentItem);
            }
          });

          // Now render each group
          groups.forEach(group => {
            const blockId = 'trace' + traceIdx + '-block' + blockIdx;
            let renderBlockType = group.type;
            let displayId = '';
            let mergedContent = null;

            // Determine display block type and ID
            if (group.type === 'text') {
              renderBlockType = 'assistant';
              if (group.items.length > 1) {
                // Merge all text items into a single text block
                const mergedText = group.items.map(item => item.text || '').join('');
                mergedContent = { type: 'text', text: mergedText };
                const contentHash = simpleHash(mergedText);
                displayId = contentHash.substring(0, 4).toUpperCase();
              } else {
                const contentHash = simpleHash(getHashableContent(group.items[0]));
                displayId = contentHash.substring(0, 4).toUpperCase();
                mergedContent = group.items[0];
              }
            } else if (group.type === 'thinking') {
              renderBlockType = 'assistant';
              if (group.items.length > 1) {
                // Merge all thinking items into a single thinking block
                const mergedThinking = group.items.map(item => item.thinking || '').join('');
                mergedContent = { type: 'thinking', thinking: mergedThinking };
                const contentHash = simpleHash(mergedThinking);
                displayId = 'Think-' + contentHash.substring(0, 4).toUpperCase();
              } else {
                const contentHash = simpleHash(getHashableContent(group.items[0]));
                displayId = 'Think-' + contentHash.substring(0, 4).toUpperCase();
                mergedContent = group.items[0];
              }
            } else if (group.type === 'tool_use') {
              renderBlockType = 'tool_use';
              const toolName = group.items[0].name || 'unknown';
              if (group.items[0].id && group.items[0].id.startsWith('toolu_')) {
                const idPart = group.items[0].id.substring(6);
                displayId = toolName + '-' + idPart.substring(0, 4).toUpperCase();
              } else {
                displayId = toolName;
              }
              mergedContent = group.items[0];
            } else if (group.type === 'server_tool_use') {
              renderBlockType = 'tool_use';
              const toolName = group.items[0].name || 'unknown';
              if (group.items[0].id && group.items[0].id.startsWith('srvtoolu_')) {
                const idPart = group.items[0].id.substring(9);
                displayId = toolName + '-' + idPart.substring(0, 4).toUpperCase();
              } else {
                displayId = toolName;
              }
              mergedContent = group.items[0];
            } else if (group.type === 'web_search_tool_result') {
              renderBlockType = 'tool_result';
              const toolName = toolUseMap[group.items[0].tool_use_id] || 'web_search';
              if (group.items[0].tool_use_id && group.items[0].tool_use_id.startsWith('srvtoolu_')) {
                const idPart = group.items[0].tool_use_id.substring(9);
                displayId = toolName + '-' + idPart.substring(0, 4).toUpperCase();
              } else {
                displayId = toolName;
              }
              mergedContent = group.items[0];
            } else {
              const contentHash = simpleHash(getHashableContent(group.items[0]));
              displayId = contentHash.substring(0, 4).toUpperCase();
              mergedContent = group.items[0];
            }

            blockDataStore[exampleId + '-' + blockId] = {
              type: renderBlockType,
              content: mergedContent,
              displayId: displayId
            };

            let blockHtml = '<div id=\"block-' + exampleId + '-' + blockId + '\" class=\"block ' + renderBlockType + '\" onclick=\"showBlockDetail(\\\'' + exampleId + '\\\', \\\'' + blockId + '\\\')\">';
            blockHtml += formatBlockType(renderBlockType) + '/' + displayId;
            blockHtml += '</div>';

            blocks.push({ html: blockHtml, isContinued: false });
            blockIdx++;
          });
        }
      }

      return groupAndRenderBlocks(blocks);
    }

    function renderExampleDetail(exampleId, data, detailContainer) {
      const detailDiv = detailContainer;

      // Store system prompts for this example
      if (data.systemPrompts) {
        systemPromptsCache[exampleId] = data.systemPrompts;
      }

      // Clear old block data for this example
      Object.keys(blockDataStore).forEach(key => {
        if (key.startsWith(exampleId + '-')) {
          delete blockDataStore[key];
        }
      });

      let html = '<div class="split-view">';
      html += '<div class="blocks-panel">';

      // Render CLI log if available
      if (data.cliLog) {
        html += '<div class="cli-log">';
        html += '<h3>CLI Interaction Log</h3>';
        html += escapeHtml(data.cliLog);
        html += '</div>';
      }

      html += '<div class="timeline">';

      // Prepare trace levels for all traces based on system prompt content
      const traceLevels = [];
      data.llmTraces.forEach((trace, idx) => {
        // Determine the level of this trace
        let level = 'third'; // default to third

        if (trace.type === 'request') {
          // Determine level based on system prompt content
          level = determineTraceLevel(trace, systemPromptsCache[exampleId] || {});
        } else if (trace.type === 'response') {
          // For response, use the level of the previous request
          for (let i = idx - 1; i >= 0; i--) {
            if (data.llmTraces[i].type === 'request') {
              level = traceLevels[i]; // Use already determined level
              break;
            }
          }
        }
        traceLevels.push(level);
      });

      // Render swimlane headers
      html += '<div class="swimlane-headers">';
      html += '<div class="swimlane-header">Main Flow</div>';
      html += '<div class="swimlane-header">Task and Sub-Agent</div>';
      html += '<div class="swimlane-header">Others</div>';
      html += '</div>';

      // Render timeline content as rows
      html += '<div class="timeline-content">';

      data.llmTraces.forEach((trace, idx) => {
        const level = traceLevels[idx];

        html += '<div class="timeline-row">';

        // Render three cells (main, second, third)
        ['main', 'second', 'third'].forEach(swimlaneLevel => {
          html += '<div class="timeline-cell">';

          if (level === swimlaneLevel) {
            // This trace belongs to this swimlane
            const eventClass = trace.type === 'response' ? 'event response' : 'event';
            let metaInfo = '';
            if (trace.type === 'request' && trace.data.model) {
              metaInfo = formatModelName(trace.data.model);
              // Add "/thinking" suffix if request has thinking enabled
              if (trace.data.thinking && trace.data.thinking.type === 'enabled') {
                metaInfo += '/thinking';
              }
            }

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
              html += renderBlocks(exampleId, trace, idx, previousRequestTrace, data.llmTraces, level, traceLevels, systemPromptsCache[exampleId] || {});
              html += '</div>';
            } else {
              // For responses, also render as blocks
              html += '<div class="blocks-container">';
              html += renderBlocks(exampleId, trace, idx, null, data.llmTraces, level, traceLevels, systemPromptsCache[exampleId] || {});
              html += '</div>';
            }

            html += '</div>';
          }
          // Empty cell if this trace doesn't belong to this swimlane

          html += '</div>';
        });

        html += '</div>';
      });

      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '<div id="detail-panel-' + exampleId + '" class="detail-panel">';
      html += '<h3>Select a block to view details</h3>';
      html += '<p style="color: #858585;">Click a block on the left to view detailed content</p>';
      html += '</div>';
      html += '</div>';

      detailDiv.innerHTML = html;

      // ========== Mobile initialization ==========
      // Setup swipe gesture for mobile drawer
      if (isMobileView()) {
        setupDrawerSwipe(exampleId);
      }

      // Handle window resize (desktop ↔ mobile switching)
      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          // Close drawer when switching to desktop
          if (!isMobileView()) {
            closeMobileDrawer(exampleId);
          }
        }, 250);
      });
    }

    // Auto-load first example on page load
    window.addEventListener('DOMContentLoaded', function() {
      // Trigger change event to load the first example
      const select = document.getElementById('example-select');
      if (select && select.value) {
        handleExampleChange();
      }
    });
  `;
}

function renderExampleSelector(examples) {
  let html = '<div class="example-selector" style="margin: 20px 0;">';
  html += '<label for="example-select" style="display: block; margin-bottom: 10px; color: #4ec9b0; font-weight: bold;">Select Example:</label>';
  html += '<select id="example-select" onchange="handleExampleChange()" style="width: 100%; padding: 10px; background: #2d2d30; color: #d4d4d4; border: 1px solid #3e3e42; border-radius: 4px; font-family: inherit; font-size: 14px;">';
  html += '<option value="">-- Choose an example --</option>';

  examples.forEach((ex, idx) => {
    // Select first example by default
    const selected = idx === 0 ? ' selected' : '';
    html += `<option value="${ex.id}"${selected}>${ex.id}</option>`;
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
      const systemPrompts = loadSystemPrompts();
      res.json({ ...exampleData, systemPrompts });
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

// Export functions for reuse
module.exports = {
  scanExamples,
  loadSystemPrompts,
  parseLLMFile,
  parseExample,
  getCSS,
  getClientJS,
  generateHTML,
  renderExampleSelector
};

// Only run server if executed directly (not during testing)
if (require.main === module) {
  startServer();
}
