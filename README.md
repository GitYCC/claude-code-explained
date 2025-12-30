# Claude Code Explained

Interactive visualization tool for understanding how Claude Code works through execution traces.

## What is This?

This project helps you understand **Claude Code's** internal workings by providing:

- **Real execution traces**: LLM API request/response logs from actual Claude Code sessions
- **CLI interaction logs**: Complete records of command-line interactions
- **Interactive viewer**: A web-based tool to explore execution flows

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start the development server
npm start
```

The development server will start at `http://localhost:3000` and automatically open in your browser.

### Build for Production

```bash
# Build static site
npm run build
```

This generates a static HTML file in the `dist/` directory that can be deployed to any web server.

## Project Structure

```
claude-code-explained/
├── examples/              # Claude Code usage examples
│   └── 01_xxx/           # Each example contains:
│       ├── cli.txt       # CLI interaction log
│       └── llm/          # LLM API traces
│           ├── [timestamp] Request - api.anthropic.com_v1_messages.txt
│           └── [timestamp] Response - api.anthropic.com_v1_messages.txt
├── view.js               # Development server
├── build.js              # Static site generator
└── dist/                 # Build output (generated)
```

## Deploying to GitHub Pages

### Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it (e.g., `claude-code-explained`)
3. Make it public (required for free GitHub Pages)

### Step 2: Push to GitHub

```bash
# Initialize git (if not already done)
git init

# Add remote
git remote add origin https://github.com/yourusername/your-repo-name.git

# Add all files
git add .

# Commit
git commit -m "Initial commit"

# Push to GitHub
git branch -M main
git push -u origin main
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under "Build and deployment":
   - Source: Select **GitHub Actions**

That's it! The GitHub Actions workflow will automatically:
- Build the static site
- Deploy to GitHub Pages
- Make it available at: `https://yourusername.github.io/your-repo-name/`

## Adding New Examples

To add a new Claude Code usage example:

1. Create a new directory under `examples/` with format: `NN_description`
   - Example: `02_implement-feature`

2. Add the CLI interaction log:
   - Save as `cli.txt` in the example directory

3. Add LLM traces:
   - Create an `llm/` subdirectory
   - Add request/response files with format:
     - `[timestamp] Request - api.anthropic.com_v1_messages.txt`
     - `[timestamp] Response - api.anthropic.com_v1_messages.txt`

4. Rebuild:
   ```bash
   npm run build
   ```

The new example will automatically appear in the viewer!

## How It Works

### Development Mode (`npm start`)

- Runs an Express server
- Dynamically scans `examples/` directory
- Parses LLM trace files on-demand
- Provides a live, interactive interface

### Production Mode (`npm run build`)

- Pre-parses all examples
- Embeds all data into a single HTML file
- Generates fully static output
- No server required - works on GitHub Pages!

## Features

- 📊 **Statistics**: View total traces, request/response counts
- 🔍 **Interactive Timeline**: Click to expand and view detailed traces
- 🎨 **Syntax Highlighting**: Color-coded for requests and responses
- 📱 **Responsive Design**: Works on desktop and mobile

## Technologies

- **Frontend**: Vanilla JavaScript (no frameworks)
- **Development Server**: Express.js
- **Build Tool**: Custom Node.js script
- **Deployment**: GitHub Pages via GitHub Actions
- **Styling**: CSS (VS Code Dark theme)

## Contributing

Contributions are welcome! If you have interesting Claude Code execution traces:

1. Fork this repository
2. Add your example following the structure above
3. Submit a pull request

## License

MIT

## Author

Yi-Chang Chen
