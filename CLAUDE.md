# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案目標

這個 repository 的目標是透過互動式圖解來幫助使用者理解 Claude Code 的運作原理。專案會收集和展示 Claude Code 在各種使用情境下的執行記錄,包括 LLM 的請求/回應追蹤、CLI 互動過程等。

## 專案架構

### 目錄結構

```
claude-code-explained/
├── examples/              # 各種使用情境的範例
│   └── 01_xxx/           # 每個範例包含:
│       ├── cli.txt       # CLI 互動過程記錄
│       └── llm/          # LLM API 請求/回應追蹤檔案
│           ├── [timestamp] Request - api.anthropic.com_v1_messages.txt
│           └── [timestamp] Response - api.anthropic.com_v1_messages.txt
├── prompts/              # Claude Code 提示和工具定義
│   ├── system/          # 系統級提示 (6 files)
│   │   ├── analyze-topic.md
│   │   ├── explore-agent.md
│   │   ├── interactive-cli.md
│   │   └── ... 其他系統提示
│   ├── tool/            # Claude Code 工具定義 (18 files)
│   │   ├── task.md
│   │   ├── bash.md
│   │   ├── read.md
│   │   └── ... 其他工具
│   └── user/            # 用戶級提示 (3 files)
│       ├── prompt-suggestion.md
│       └── ... 其他用戶提示
└── CLAUDE.md             # 本檔案
```

### 範例命名規範

- 範例目錄以數字前綴命名: `01_`, `02_`, `03_` 等
- 目錄名稱應清楚描述使用情境,例如: `01_explain-this-repo-and-dump-to-contentmd`
- 使用小寫字母和連字符 `-` 分隔單字

### Prompts 目錄結構

- `prompts/system/` - 存放系統級 Claude Code 提示模板（6個文件）
- `prompts/tool/` - 存放 Claude Code 工具定義及使用說明（18個文件）
  - 每個工具文件採用 YAML frontmatter 格式，包含 `name` 和 `input_schema`
  - description 部分使用 markdown 格式撰寫
- `prompts/user/` - 存放用戶級提示（如提醒、建議等，3個文件）
- 文件命名使用小寫字母和連字符，例如: `interactive-cli.md`, `task.md`
- 視覺化工具會自動遞迴掃描所有子目錄並在 LLM 追蹤中標記和匹配

## 新增範例的流程

當需要新增一個 Claude Code 使用範例時:

1. 在 `examples/` 下建立新的範例目錄,遵循命名規範
2. 將 CLI 互動過程儲存為 `cli.txt`
3. 建立 `llm/` 子目錄存放 LLM 追蹤檔案
4. LLM 追蹤檔案命名格式: `[timestamp] Request/Response - api.anthropic.com_v1_messages.txt`

## 文件撰寫原則

- 所有說明文件(包括本檔)應使用繁體中文撰寫,方便台灣使用者閱讀
- 技術術語如 "Claude Code", "LLM", "API" 等保持英文
- 程式碼註解使用英文
- 文件應簡潔明瞭,以高層次概念為主,細節以附錄形式呈現

## 未來擴充方向

此專案可能會加入:
- 互動式視覺化工具,以圖表方式呈現 LLM 請求/回應流程
- 不同使用情境的分類和索引
- 分析工具,用於統計和比較不同範例的執行特性