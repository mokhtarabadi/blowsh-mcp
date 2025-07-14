# Changelog

## [Unreleased]
- Markdown conversion now uses the [html2markdown CLI](https://github.com/JohannesKaufmann/html-to-markdown) for higher fidelity and plugin support.
- Added `src/tools/html2markdownManager.ts` as a wrapper for the CLI.
- Updated Dockerfile to install html2markdown CLI.
- Updated `.env` and `.env.example` to support `HTML2MARKDOWN_PATH`.
- Updated README with new requirements and configuration options.
- Unified all fetch tools into `fetch_web` with a `type` parameter.
- Cleaned up project by removing legacy fetch tools.
